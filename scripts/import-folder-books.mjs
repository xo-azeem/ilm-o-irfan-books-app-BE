/**
 * Import books from a local folder into a linked Supabase project.
 *
 * Folder layout (one book per directory):
 *   BOOKS_DIR/<Book Title>/
 *     <title> - <author>.pdf
 *     cover.webp|jpg|png          (optional)
 *     meta.json                   (optional: { "isPremium": true, "categorySlug": "history", "genre": "History" })
 *
 * Env:
 *   BOOKS_DIR          required path to the books root (no silent wrong default)
 *   DEFAULT_IS_PREMIUM true|false (default false)
 *   REQUIRE_COVER=1    fail import when a folder has no cover image
 *   MAX_PDF_BYTES      hard ceiling (default 80 MiB)
 *   WARN_PDF_BYTES     soft warn (default 25 MiB)
 *   DRY_RUN=1          scan + write SQL only; skip Storage upload and db query
 *   SQL_ONLY=1         same as DRY_RUN but still requires no .env for upload
 *
 * meta.json may set { "slug": "stable-id" } so renaming the folder does not change the slug.
 *
 * Usage:
 *   BOOKS_DIR=D:/Books npm run books:import
 *   BOOKS_DIR=D:/Books DRY_RUN=1 npm run books:import
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertUniqueSlugs,
  checkPdfBudget,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_WARN_PDF_BYTES,
  resolveBookSlug,
  slugify,
} from './lib/import-rules.mjs'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const SQL_PATH = join(ROOT, 'scripts', '.import-books.sql')
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.SQL_ONLY === '1'
const REQUIRE_COVER = ['true', '1', 'yes', 'on'].includes(
  (process.env.REQUIRE_COVER ?? 'false').trim().toLowerCase(),
)
const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES ?? DEFAULT_MAX_PDF_BYTES)
const WARN_PDF_BYTES = Number(process.env.WARN_PDF_BYTES ?? DEFAULT_WARN_PDF_BYTES)
const DEFAULT_IS_PREMIUM = ['true', '1', 'yes', 'on'].includes(
  (process.env.DEFAULT_IS_PREMIUM ?? 'false').trim().toLowerCase(),
)

const REQUIRED_COLLECTION_SLUGS = ['home-hero', 'trending', 'new-arrivals']

const SEEDED_CATEGORY_SLUGS = new Set([
  'quranic-studies',
  'spirituality',
  'history',
  'fiqh-law',
  'hadith',
  'arabic',
])

const COVER_COLORS = [
  ['#1B4332', '#081C15'],
  ['#2D6A4F', '#1B4332'],
  ['#95D5B2', '#40916C'],
  ['#52B788', '#1B4332'],
  ['#74C69D', '#2D6A4F'],
  ['#A3B18A', '#588157'],
  ['#C9940A', '#7A5C08'],
  ['#4A9E5C', '#1B4332'],
]

const HISTORY_SLUGS = new Set([
  'muhammad-his-conduct-and-character',
  'talash-e-hind',
  'urdu-novel-ki-tareekh',
])

function resolveBooksDir() {
  const fromEnv = process.env.BOOKS_DIR?.trim()
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`BOOKS_DIR does not exist: ${fromEnv}`)
    }
    return fromEnv
  }

  const candidates = ['D:/Books', 'D:/ilm-o-irfan-books-app/Books', 'D:/Projects/Books']
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.warn(`BOOKS_DIR not set; using discovered path ${candidate}`)
      return candidate
    }
  }

  throw new Error(
    'BOOKS_DIR is required. Example: BOOKS_DIR=D:/Books npm run books:import\n' +
      'Expected layout: BOOKS_DIR/<title>/<title> - <author>.pdf (+ optional cover.webp)',
  )
}

function sqlStr(value) {
  if (value == null) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function titleCaseFolder(name) {
  return name.replace(/\s+/g, ' ').trim()
}

function parsePdfName(filename) {
  const stem = basename(filename, extname(filename))
  const parts = stem.split(/\s*-\s*/)
  if (parts.length < 2) {
    throw new Error(`PDF name is not "<title> - <author>": ${filename}`)
  }
  const author = parts.pop().trim()
  const titleFromPdf = parts.join(' - ').trim()
  return { author, titleFromPdf }
}

function mimeForExt(ext) {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
    case '.webp':
      return 'image/webp'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

function readMeta(folderPath) {
  const metaPath = join(folderPath, 'meta.json')
  if (!existsSync(metaPath)) return {}
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid meta.json in ${folderPath}: ${error.message}`)
  }
}

function resolveCategory(slug, meta) {
  if (typeof meta.categorySlug === 'string' && meta.categorySlug.trim()) {
    return slugify(meta.categorySlug)
  }
  if (HISTORY_SLUGS.has(slug)) return 'history'
  return 'spirituality'
}

function resolveGenre(slug, meta, categorySlug) {
  if (typeof meta.genre === 'string' && meta.genre.trim()) return meta.genre.trim()
  if (HISTORY_SLUGS.has(slug)) return 'History'
  const labels = {
    'quranic-studies': 'Quranic Studies',
    spirituality: 'Spirituality',
    history: 'History',
    'fiqh-law': 'Fiqh & Law',
    hadith: 'Hadith',
    arabic: 'Arabic',
  }
  return labels[categorySlug] ?? 'Spirituality'
}

function scanBooks(booksDir) {
  const folders = readdirSync(booksDir, { withFileTypes: true }).filter((d) => d.isDirectory())
  if (folders.length === 0) {
    throw new Error(`No book folders found in ${booksDir}`)
  }

  const books = []

  for (const dir of folders) {
    const folderPath = join(booksDir, dir.name)
    const files = readdirSync(folderPath)
    const pdfName = files.find((f) => f.toLowerCase().endsWith('.pdf'))
    if (!pdfName) {
      throw new Error(`No PDF in ${dir.name}`)
    }
    const coverName = files.find((f) => /^cover\.(webp|jpg|jpeg|png)$/i.test(f))
    const meta = readMeta(folderPath)
    const { author } = parsePdfName(pdfName)
    const slug = resolveBookSlug(dir.name, meta)
    const pdfPath = join(folderPath, pdfName)
    const pdfStat = statSync(pdfPath)
    const budget = checkPdfBudget(pdfStat.size, { max: MAX_PDF_BYTES, warn: WARN_PDF_BYTES })
    if (budget.ok === false && budget.level === 'error') {
      throw new Error(`${dir.name}: ${budget.message}`)
    }
    if (budget.ok === false && budget.level === 'warn') {
      console.warn(`WARN ${dir.name}: ${budget.message}`)
    }
    const coverPath = coverName ? join(folderPath, coverName) : null
    if (!coverPath && REQUIRE_COVER) {
      throw new Error(`${dir.name}: cover.webp|jpg|png required (REQUIRE_COVER=1)`)
    }
    if (!coverPath) {
      console.warn(`WARN ${dir.name}: no cover image (Home cards will use color fallback only)`)
    }
    const coverExt = coverName ? extname(coverName).toLowerCase() : null
    const [coverColor, coverColorDark] =
      COVER_COLORS[
        Math.abs(Number.parseInt(createHash('sha1').update(slug).digest('hex').slice(0, 8), 16)) %
          COVER_COLORS.length
      ]

    const categorySlug = resolveCategory(slug, meta)
    const isPremium =
      typeof meta.isPremium === 'boolean'
        ? meta.isPremium
        : typeof meta.is_premium === 'boolean'
          ? meta.is_premium
          : DEFAULT_IS_PREMIUM

    books.push({
      folder: dir.name,
      title: titleCaseFolder(dir.name),
      author,
      authorSlug: slugify(author),
      slug,
      pdfPath,
      pdfBytes: pdfStat.size,
      coverPath,
      coverExt,
      coverObject: coverExt ? `${slug}${coverExt}` : null,
      pdfObject: `${slug}.pdf`,
      coverColor,
      coverColorDark,
      genre: resolveGenre(slug, meta, categorySlug),
      categorySlug,
      isPremium,
      readTimeMinutes: Math.max(45, Math.round(pdfStat.size / (40 * 1024))),
    })
  }

  assertUniqueSlugs(books)
  return books
}

function buildSql(books) {
  const authors = [...new Map(books.map((b) => [b.authorSlug, b.author])).entries()]
  const extraCategories = [
    ...new Set(books.map((b) => b.categorySlug).filter((slug) => !SEEDED_CATEGORY_SLUGS.has(slug))),
  ]

  const lines = []
  lines.push('-- Generated by scripts/import-folder-books.mjs')
  lines.push('-- Ensures home shelves exist before membership inserts.')
  lines.push(`insert into public.collections (slug, title, subtitle, accent, kind, sort_order, is_published) values
  ('home-hero', 'Featured', 'Start here', '#2E7D32', 'hero', 1, true),
  ('trending', 'Trending now', 'Popular with readers', '#C9940A', 'shelf', 2, true),
  ('new-arrivals', 'New arrivals', 'Recently added', '#4A9E5C', 'shelf', 3, true)
on conflict (slug) do update set
  title = excluded.title,
  is_published = true;`)
  lines.push('')

  for (const slug of extraCategories) {
    lines.push(
      `insert into public.categories (slug, label, icon_key, accent, accent_dark, sort_order)
values (${sqlStr(slug)}, ${sqlStr(slug.replace(/-/g, ' '))}, 'book', '#7CB518', '#C6F542', 90)
on conflict (slug) do nothing;`,
    )
    lines.push('')
  }

  lines.push('insert into public.authors (slug, name, bio) values')
  lines.push(
    authors
      .map(
        ([slug, name]) =>
          `  (${sqlStr(slug)}, ${sqlStr(name)}, ${sqlStr('Author of titles in the Ilm o Irfan catalog.')})`,
      )
      .join(',\n'),
  )
  lines.push('on conflict (slug) do update set name = excluded.name;')
  lines.push('')

  for (const [i, book] of books.entries()) {
    const coverDbPath = book.coverObject ? `covers/${book.coverObject}` : null
    const pdfDbPath = `pdfs/${book.pdfObject}`
    const rating = 4.6 + (i % 4) * 0.1
    const publishedOffset = i
    lines.push(`insert into public.books (
  slug, title, description, author_id, genre, rating, rating_count,
  price_cents, currency, format, cover_path, cover_color, cover_color_dark,
  pdf_path, file_size_bytes, read_time_minutes, tag, tags, is_premium, is_published, published_at
)
select
  ${sqlStr(book.slug)},
  ${sqlStr(book.title)},
  ${sqlStr(`${book.title} by ${book.author}.`)},
  a.id,
  ${sqlStr(book.genre)},
  ${rating.toFixed(1)},
  0,
  0,
  'PKR',
  'Digital edition',
  ${sqlStr(coverDbPath)},
  ${sqlStr(book.coverColor)},
  ${sqlStr(book.coverColorDark)},
  ${sqlStr(pdfDbPath)},
  ${book.pdfBytes},
  ${book.readTimeMinutes},
  'New',
  array[${sqlStr(book.genre.toLowerCase())}, ${sqlStr(book.authorSlug)}],
  ${book.isPremium},
  true,
  timezone('utc', now()) - (${publishedOffset} * interval '1 hour')
from public.authors a
where a.slug = ${sqlStr(book.authorSlug)}
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  author_id = excluded.author_id,
  genre = excluded.genre,
  cover_path = excluded.cover_path,
  cover_color = excluded.cover_color,
  cover_color_dark = excluded.cover_color_dark,
  pdf_path = excluded.pdf_path,
  file_size_bytes = excluded.file_size_bytes,
  read_time_minutes = excluded.read_time_minutes,
  tags = excluded.tags,
  is_premium = excluded.is_premium,
  is_published = excluded.is_published,
  published_at = excluded.published_at;`)
    lines.push('')
    lines.push(`insert into public.book_categories (book_id, category_id)
select b.id, c.id
from public.books b
join public.categories c on c.slug = ${sqlStr(book.categorySlug)}
where b.slug = ${sqlStr(book.slug)}
on conflict do nothing;`)
    lines.push('')
  }

  const slugList = books.map((b) => sqlStr(b.slug)).join(', ')

  for (const collectionSlug of REQUIRED_COLLECTION_SLUGS) {
    const orderExpr =
      collectionSlug === 'trending'
        ? 'row_number() over (order by b.rating desc nulls last, b.title)'
        : 'row_number() over (order by b.published_at desc nulls last, b.title)'

    lines.push(`insert into public.collection_books (collection_id, book_id, sort_order)
select col.id, b.id, ${orderExpr}
from public.collections col
join public.books b on b.slug in (${slugList})
where col.slug = ${sqlStr(collectionSlug)}
on conflict do nothing;`)
    lines.push('')
  }

  lines.push(`-- Publish checklist (informational — run after import)
-- PDF + cover paths, author, categories, home-shelf membership:
-- select b.slug, b.is_published, b.pdf_path, b.cover_path, b.author_id is not null as has_author,
--   exists (select 1 from public.book_categories bc where bc.book_id = b.id) as has_category,
--   exists (
--     select 1 from public.collection_books cb
--     join public.collections c on c.id = cb.collection_id
--     where cb.book_id = b.id and c.slug in ('home-hero','trending','new-arrivals')
--   ) as on_home_shelf
-- from public.books b
-- where b.slug in (${slugList});`)

  return `${lines.join('\n')}\n`
}

function loadEnv() {
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) {
    throw new Error('Missing .env (copy from .env.example). Required for Storage upload + db query.')
  }
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i === -1) continue
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return env
}

function supabase(args) {
  execFileSync('npx', ['supabase', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
}

async function uploadObject(env, bucket, objectPath, localPath, contentType) {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`
  const body = readFileSync(localPath)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Upload ${bucket}/${objectPath} failed (${response.status}): ${text}`)
  }
}

const booksDir = resolveBooksDir()
const books = scanBooks(booksDir)
console.log(`Found ${books.length} books in ${booksDir}`)
for (const book of books) {
  console.log(
    `- ${book.title} / ${book.author} [${book.categorySlug}] premium=${book.isPremium}${
      book.coverObject ? '' : ' (no cover)'
    }`,
  )
}

writeFileSync(SQL_PATH, buildSql(books), 'utf8')
console.log(`Wrote catalog SQL → ${SQL_PATH}`)

if (DRY_RUN) {
  console.log('DRY_RUN/SQL_ONLY set — skipping Storage upload and db query.')
  process.exit(0)
}

const env = loadEnv()
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
}

for (const book of books) {
  console.log(`Uploading PDF ${book.slug}`)
  await uploadObject(env, 'pdfs', book.pdfObject, book.pdfPath, 'application/pdf')
  if (book.coverPath && book.coverObject) {
    console.log(`Uploading cover ${book.coverObject}`)
    await uploadObject(
      env,
      'covers',
      book.coverObject,
      book.coverPath,
      mimeForExt(book.coverExt),
    )
  }
}

supabase(['db', 'query', '--linked', '--file', SQL_PATH])
console.log('Import finished. Run admin_storage_audit() after deploy to verify paths.')
