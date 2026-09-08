// Discover filter parsing, shared by books-list and books-search.
//
// One rule governs everything here: an unrecognised value is ignored, never a
// 400. An older app build has to keep working against a newer deployment and a
// newer build against an older one, so a filter the backend does not understand
// must degrade to "no filter" rather than break the screen.
//
// The filters themselves are applied by public.catalog_books, before LIMIT, so
// totalCount / totalPages / hasNextPage describe matches rather than rows.

export const LANGUAGES = ['urdu', 'english', 'arabic'] as const
export const LENGTHS = ['short', 'medium', 'long'] as const
export const SORTS = ['newest', 'rating', 'title', 'relevance'] as const

export type CatalogArgs = {
  p_query: string | null
  p_category: string | null
  p_premium: boolean | null
  p_min_rating: number | null
  p_languages: string[] | null
  p_lengths: string[] | null
  p_sort: string | null
  p_limit: number
  p_offset: number
}

function firstParam(params: URLSearchParams, names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name)
    if (value !== null && value.trim() !== '') {
      return value.trim()
    }
  }
  return null
}

// Repeated values inside one parameter OR together, so multi-select chips send
// `length=short,long`. Repeating the key (`?length=short&length=long`) works
// too, because a client library may serialise an array either way.
function parseEnumList(
  params: URLSearchParams,
  names: string[],
  allowed: readonly string[],
): string[] | null {
  const raw: string[] = []

  for (const name of names) {
    for (const value of params.getAll(name)) {
      raw.push(...value.split(','))
    }
  }

  const picked = [
    ...new Set(
      raw
        .map((value) => value.trim().toLowerCase())
        .filter((value) => (allowed as readonly string[]).includes(value)),
    ),
  ]

  // Every value was unrecognised (or none was sent): no filter, not an error.
  return picked.length > 0 ? picked : null
}

function parseBoolean(params: URLSearchParams, names: string[]): boolean | null {
  const raw = firstParam(params, names)?.toLowerCase()

  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false

  return null
}

function parseRating(params: URLSearchParams, names: string[]): number | null {
  const raw = firstParam(params, names)
  if (raw === null) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null

  // Clamped rather than rejected: `minRating=9` means "the best you have", not
  // an error, and rating is constrained to 0-5 in the schema anyway.
  return Math.min(Math.max(parsed, 0), 5)
}

function parseSort(params: URLSearchParams): string | null {
  const raw = firstParam(params, ['sort', 'orderBy', 'order_by'])?.toLowerCase()
  return raw && (SORTS as readonly string[]).includes(raw) ? raw : null
}

/**
 * Reads every Discover filter off the URL. `query` is passed in rather than
 * read here, because books-list ignores `q` and books-search requires it.
 */
export function catalogArgsFromRequest(
  req: Request,
  opts: { query?: string | null; limit: number; offset: number },
): CatalogArgs {
  const params = new URL(req.url).searchParams

  return {
    p_query: opts.query ?? null,
    p_category: firstParam(params, ['category', 'categoryId', 'category_id', 'categorySlug']),
    p_premium: parseBoolean(params, ['premium', 'isPremium', 'is_premium']),
    p_min_rating: parseRating(params, ['minRating', 'min_rating']),
    p_languages: parseEnumList(params, ['language', 'languages'], LANGUAGES),
    p_lengths: parseEnumList(params, ['length', 'lengths'], LENGTHS),
    p_sort: parseSort(params),
    p_limit: opts.limit,
    p_offset: opts.offset,
  }
}

export type CatalogRow = Record<string, unknown> & { total_count?: number | string | null }

/**
 * Splits catalog_books rows into the cards the app sees and the window count
 * that rides along on every row.
 */
export function splitCatalogRows(
  rows: CatalogRow[],
): { items: Record<string, unknown>[]; totalCount: number } {
  if (rows.length === 0) {
    return { items: [], totalCount: 0 }
  }

  const parsed = Number(rows[0].total_count ?? 0)

  return {
    items: rows.map(({ total_count: _ignored, ...book }) => book),
    totalCount: Number.isFinite(parsed) ? parsed : 0,
  }
}
