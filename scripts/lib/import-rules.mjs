/**
 * Pure helpers for books:import — slug stability, uniqueness, PDF size budget.
 * Kept separate so Node's test runner can cover them without Storage/DB.
 */

/** Default hard ceiling (bytes). Override with MAX_PDF_BYTES. */
export const DEFAULT_MAX_PDF_BYTES = 80 * 1024 * 1024

/** Soft warning threshold (bytes). Override with WARN_PDF_BYTES. */
export const DEFAULT_WARN_PDF_BYTES = 25 * 1024 * 1024

export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Stable slug: meta.slug wins when set (ops lock); otherwise folder name.
 * Never derive from PDF filename — that changes when titles are retitled in Storage.
 */
export function resolveBookSlug(folderName, meta = {}) {
  const fromMeta =
    typeof meta.slug === 'string' && meta.slug.trim() ? slugify(meta.slug) : ''
  const fromFolder = slugify(folderName)
  const slug = fromMeta || fromFolder
  if (!slug) {
    throw new Error(
      `Could not derive a stable slug for folder "${folderName}". ` +
        'Rename the folder or set meta.json { "slug": "my-book" }.',
    )
  }
  return slug
}

export function assertUniqueSlugs(books) {
  const seen = new Map()
  for (const book of books) {
    const prev = seen.get(book.slug)
    if (prev) {
      throw new Error(
        `Duplicate book slug "${book.slug}" from folders "${prev}" and "${book.folder}". ` +
          'Rename a folder or set distinct meta.slug values.',
      )
    }
    seen.set(book.slug, book.folder)
  }
}

/**
 * @returns {{ ok: true } | { ok: false, level: 'warn'|'error', message: string }}
 */
export function checkPdfBudget(bytes, { max = DEFAULT_MAX_PDF_BYTES, warn = DEFAULT_WARN_PDF_BYTES } = {}) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, level: 'error', message: 'PDF size is missing or zero' }
  }
  if (bytes > max) {
    return {
      ok: false,
      level: 'error',
      message: `PDF is ${(bytes / (1024 * 1024)).toFixed(1)} MB; max is ${(max / (1024 * 1024)).toFixed(0)} MB (MAX_PDF_BYTES)`,
    }
  }
  if (bytes > warn) {
    return {
      ok: false,
      level: 'warn',
      message: `PDF is ${(bytes / (1024 * 1024)).toFixed(1)} MB (warn at ${(warn / (1024 * 1024)).toFixed(0)} MB)`,
    }
  }
  return { ok: true }
}

/** Collection kinds the Home UI and CMS accept. */
export const COLLECTION_KINDS = Object.freeze(['hero', 'shelf', 'carousel'])

export function assertCollectionKind(kind) {
  if (!COLLECTION_KINDS.includes(kind)) {
    throw new Error(`kind must be one of: ${COLLECTION_KINDS.join(', ')}`)
  }
}
