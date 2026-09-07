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
