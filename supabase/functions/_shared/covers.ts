// Public cover URLs for catalog / library payloads.
//
// covers is a PUBLIC bucket. The phone must not invent Storage URL rules —
// every book card that carries cover_path also carries coverUrl (or null).
// Path forms seen in the wild: "covers/slug.webp", "/covers/slug.webp", "slug.webp".

const COVERS_BUCKET = 'covers'

export function supabasePublicUrl(): string {
  return (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
}

/** Strip bucket prefix / leading slashes so the key matches storage.objects.name. */
export function coverObjectKey(coverPath: string | null | undefined): string | null {
  if (coverPath == null) return null

  const trimmed = String(coverPath).trim()
  if (!trimmed) return null

  const noLeading = trimmed.replace(/^\/+/, '')
  const withoutBucket = noLeading.replace(new RegExp(`^${COVERS_BUCKET}/`, 'i'), '')
  return withoutBucket || null
}

export function publicCoverUrl(coverPath: string | null | undefined): string | null {
  const key = coverObjectKey(coverPath)
  const base = supabasePublicUrl()

  if (!key || !base) return null

  return `${base}/storage/v1/object/public/${COVERS_BUCKET}/${key}`
}

export type WithCoverUrl<T> = T & { coverUrl: string | null }

/** Attach coverUrl from cover_path on a flat book / list-item row. */
export function withCoverUrl<T extends Record<string, unknown>>(book: T): WithCoverUrl<T> {
  const path = book.cover_path
  return {
    ...book,
    coverUrl: publicCoverUrl(typeof path === 'string' ? path : null),
  }
}

export function withCoverUrls<T extends Record<string, unknown>>(books: T[]): WithCoverUrl<T>[] {
  return books.map((book) => withCoverUrl(book))
}

/**
 * Library shelves nest the card under `book`. Mutates a shallow copy so
 * coverUrl lands next to cover_path without rewriting the parent row shape.
 */
export function withNestedBookCoverUrl<T extends Record<string, unknown>>(row: T): T {
  const nested = row.book
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return row
  }

  return {
    ...row,
    book: withCoverUrl(nested as Record<string, unknown>),
  }
}

export function withNestedBookCoverUrls<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => withNestedBookCoverUrl(row))
}

/**
 * Carousel slides carry two images: the book's own cover, and the artwork the
 * admin optionally overrode it with. Both live in the covers bucket, so both
 * get a URL here — same reason as everywhere else in this file, the phone must
 * not be the thing that knows how a Storage path becomes a URL.
 *
 * `image_path` already falls back to `cover_path` in the carousel_items view,
 * so `imageUrl` is never null while `coverUrl` is set.
 */
export function withCarouselUrl<T extends Record<string, unknown>>(slide: T): T {
  const imagePath = slide.image_path

  return {
    ...withCoverUrl(slide),
    imageUrl: publicCoverUrl(typeof imagePath === 'string' ? imagePath : null),
  }
}

export function withCarouselUrls<T extends Record<string, unknown>>(slides: T[]): T[] {
  return slides.map((slide) => withCarouselUrl(slide))
}

/**
 * The recommendations payload is built as JSON in Postgres, so the cards arrive
 * nested: sections[].seedBook, sections[].books[], and a flat books[]. Walk the
 * shape once here rather than teaching the database how to build a URL that
 * depends on SUPABASE_URL.
 */
export function withRecommendationCoverUrls(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const card = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? withCoverUrl(value as Record<string, unknown>)
      : value

  const cards = (value: unknown) => (Array.isArray(value) ? value.map(card) : value)

  const sections = Array.isArray(payload.sections)
    ? payload.sections.map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        return section
      }

      const row = section as Record<string, unknown>
      return { ...row, seedBook: card(row.seedBook), books: cards(row.books) }
    })
    : payload.sections

  return { ...payload, sections, books: cards(payload.books) }
}
