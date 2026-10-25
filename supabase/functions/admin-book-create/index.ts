import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { LANGUAGES } from '../_shared/catalog-filters.ts'
import {
  asBoolean,
  asDecimal,
  asInteger,
  asOptionalEnum,
  asOptionalInteger,
  asOptionalText,
  asStringArray,
  asUuid,
  pickProvided,
  type FieldSpec,
} from '../_shared/payload.ts'
import { assertPublishable } from '../_shared/publishing.ts'

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const OPTIONAL_FIELDS: FieldSpec[] = [
  { column: 'description', aliases: ['description'], coerce: asOptionalText('description') },
  { column: 'genre', aliases: ['genre'], coerce: asOptionalText('genre') },
  {
    column: 'price_cents',
    aliases: ['price_cents', 'priceCents'],
    coerce: asInteger('price_cents', { min: 0 }),
  },
  { column: 'currency', aliases: ['currency'], coerce: asOptionalText('currency') },
  { column: 'format', aliases: ['format'], coerce: asOptionalText('format') },
  { column: 'cover_path', aliases: ['cover_path', 'coverPath'], coerce: asOptionalText('cover_path') },
  {
    column: 'cover_color',
    aliases: ['cover_color', 'coverColor'],
    coerce: asOptionalText('cover_color'),
  },
  {
    column: 'cover_color_dark',
    aliases: ['cover_color_dark', 'coverColorDark'],
    coerce: asOptionalText('cover_color_dark'),
  },
  { column: 'pdf_path', aliases: ['pdf_path', 'pdfPath'], coerce: asOptionalText('pdf_path') },
  {
    column: 'file_size_bytes',
    aliases: ['file_size_bytes', 'fileSizeBytes'],
    coerce: asOptionalInteger('file_size_bytes', { min: 0 }),
  },
  {
    column: 'read_time_minutes',
    aliases: ['read_time_minutes', 'readTimeMinutes'],
    coerce: asOptionalInteger('read_time_minutes', { min: 0 }),
  },
  // A real page count, when someone knows it. It overrides the estimate the
  // length filter otherwise derives from read_time_minutes.
  {
    column: 'page_count',
    aliases: ['page_count', 'pageCount'],
    coerce: asOptionalInteger('page_count', { min: 1 }),
  },
  {
    column: 'language',
    aliases: ['language'],
    coerce: asOptionalEnum('language', LANGUAGES),
  },
  { column: 'tag', aliases: ['tag'], coerce: asOptionalText('tag') },
  { column: 'tags', aliases: ['tags'], coerce: asStringArray('tags') },
  { column: 'is_premium', aliases: ['is_premium', 'isPremium'], coerce: asBoolean('is_premium') },
  {
    // Editorial, like the rest of this list — see the note in
    // admin-book-update. Omitted, the column default of 0.0 stands.
    column: 'rating',
    aliases: ['rating'],
    coerce: asDecimal('rating', { min: 0, max: 5, places: 1 }),
  },
  {
    column: 'is_published',
    aliases: ['is_published', 'isPublished'],
    coerce: asBoolean('is_published'),
  },
]

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    const titleRaw = payload.title
    if (typeof titleRaw !== 'string' || !titleRaw.trim()) {
      return fail('INVALID_REQUEST', 'title is required', 400)
    }
    const title = titleRaw.trim()

    const authorId = asUuid('authorId')(payload.authorId ?? payload.author_id)

    const slug =
      typeof payload.slug === 'string' && payload.slug.trim()
        ? slugify(payload.slug.trim())
        : slugify(title)

    if (!slug) {
      return fail('INVALID_REQUEST', 'slug could not be derived from title', 400)
    }

    const optional = pickProvided(payload, OPTIONAL_FIELDS)

    // Publishing at create time is allowed, but only against a file that is
    // actually in the bucket. Otherwise create it unpublished, upload, publish.
    if (optional.is_published === true) {
      await assertPublishable(ctx.admin, optional.pdf_path as string | null | undefined)
    }

    // The catalogue is subscription-only, so an omitted is_premium means
    // premium. The column default says the same thing; stating it here too
    // means a future insert that stops relying on the default cannot quietly
    // create a free book. Access does not depend on this - get-signed-pdf
    // requires an entitlement either way - but the flag should still be right.
    const row = {
      title,
      slug,
      author_id: authorId,
      description: (optional.description as string | null | undefined) ?? '',
      is_premium: true,
      ...optional,
    }

    const { data, error } = await ctx.admin.from('books').insert(row).select().maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return fail('INVALID_REQUEST', 'A book with this slug already exists', 400)
      }
      if (error.code === '23503') {
        return fail('INVALID_REQUEST', 'authorId does not exist', 400)
      }
      return failFromDbError(
        'admin-book-create',
        'ADMIN_BOOK_CREATE_FAILED',
        'Unable to create book',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-book-create', error)
  }
})
