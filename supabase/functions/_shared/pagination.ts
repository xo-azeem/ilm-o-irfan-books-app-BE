import { BadRequestError } from './http.ts'

export type PaginationParams = {
  page?: number | string
  pageSize?: number | string
  defaultPage?: number
  defaultPageSize?: number
  maxPageSize?: number
  maxOffset?: number
}

// Offset pagination reads and discards every preceding row, so page 50,000 is a
// full table scan dressed up as a list request. Nothing in the product needs to
// reach past this, and a client that asks is either looping or scraping.
export const MAX_OFFSET = 10_000

export type PaginationMeta = {
  page: number
  pageSize: number
  totalCount: number | null
  totalPages: number | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export type PaginatedResult<T> = PaginationMeta & {
  data: T[]
}

// Keep incoming query values safe and predictable.
export function normalizePage(
  value: number | string | undefined,
  defaultPage = 1,
): number {
  const parsed = Number(value ?? defaultPage)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultPage
  }

  return Math.trunc(parsed)
}

// Prevent oversized page requests.
export function normalizePageSize(
  value: number | string | undefined,
  defaultPageSize = 20,
  maxPageSize = 100,
): number {
  const parsed = Number(value ?? defaultPageSize)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultPageSize
  }

  return Math.min(Math.trunc(parsed), maxPageSize)
}

// Converts page number + size into SQL range values.
export function getPaginationRange(
  page: number | string | undefined,
  pageSize: number | string | undefined,
  opts: Partial<PaginationParams> = {},
): { page: number; pageSize: number; offset: number; limit: number } {
  const safePage = normalizePage(page, opts.defaultPage ?? 1)
  const safePageSize = normalizePageSize(
    pageSize,
    opts.defaultPageSize ?? 20,
    opts.maxPageSize ?? 100,
  )

  const offset = (safePage - 1) * safePageSize

  return {
    page: safePage,
    pageSize: safePageSize,
    offset,
    limit: safePageSize,
  }
}

// Builds the final paginated response for a list endpoint.
export function paginate<T>(
  items: T[],
  totalCount: number | null,
  page: number | string | undefined,
  pageSize: number | string | undefined,
  opts: Partial<PaginationParams> = {},
): PaginatedResult<T> {
  const { page: safePage, pageSize: safePageSize } = getPaginationRange(
    page,
    pageSize,
    opts,
  )

  const totalPages =
    totalCount == null ? null : Math.max(0, Math.ceil(totalCount / safePageSize))

  return {
    data: items,
    page: safePage,
    pageSize: safePageSize,
    totalCount,
    totalPages,
    hasNextPage:
      totalCount == null
        ? items.length === safePageSize
        : safePage * safePageSize < totalCount,
    hasPreviousPage: safePage > 1,
  }
}

// Reads query values from a request object.
export function parsePaginationQuery(
  params: Record<string, string | undefined>,
  defaultPage = 1,
  defaultPageSize = 20,
  maxPageSize = 100,
): { page: number; pageSize: number } {
  return {
    page: normalizePage(params.page ?? params.pageNumber, defaultPage),
    pageSize: normalizePageSize(
      params.pageSize ?? params.limit,
      defaultPageSize,
      maxPageSize,
    ),
  }
}

// PostgREST answers a Range that starts past the last row with 416 /
// PGRST103 rather than an empty body. That is not an edge case: it is the
// final call of every "load more" loop, so without this an infinite-scroll
// list ends in a 500 the moment the user reaches the bottom.
//
// The right answer is the empty tail page, which is what a paging client is
// waiting for. totalCount comes back as null here because PostgREST sends no
// count with the error; hasNextPage is false either way, and that is the field
// the client stops on.
export const RANGE_NOT_SATISFIABLE = 'PGRST103'

export function isRangeNotSatisfiable(
  error: { code?: string } | null | undefined,
): boolean {
  return error?.code === RANGE_NOT_SATISFIABLE
}

// Rejects a page whose offset would run past MAX_OFFSET. Throwing beats
// silently clamping: a client that pages forever should be told it has left the
// range, not handed the last page over and over as if it were new data.
export function assertOffsetInRange(offset: number, maxOffset = MAX_OFFSET): void {
  if (offset > maxOffset) {
    throw new BadRequestError(
      `Page is out of range. Offset pagination stops at ${maxOffset} rows; narrow the query instead.`,
      'PAGE_OUT_OF_RANGE',
    )
  }
}

// Reads page/pageSize off a Request URL and returns everything a PostgREST
// .range() call needs. Every list endpoint goes through this so the offset
// arithmetic exists in exactly one place.
export function rangeFromRequest(
  req: Request,
  opts: Partial<PaginationParams> = {},
): { page: number; pageSize: number; from: number; to: number } {
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams.entries())

  const { page, pageSize } = parsePaginationQuery(
    params,
    opts.defaultPage ?? 1,
    opts.defaultPageSize ?? 20,
    opts.maxPageSize ?? 100,
  )

  const from = (page - 1) * pageSize
  assertOffsetInRange(from, opts.maxOffset ?? MAX_OFFSET)

  return { page, pageSize, from, to: from + pageSize - 1 }
}

// Cursor-based helper for scroll or load-more style APIs.
export function buildCursorPagination<T>(
  items: T[],
  getCursor: (item: T) => string,
  pageSize: number,
  opts: {
    hasNextPage?: boolean
    hasPreviousPage?: boolean
    nextCursor?: string | null
    previousCursor?: string | null
  } = {},
): {
  data: T[]
  hasNextPage: boolean
  hasPreviousPage: boolean
  nextCursor: string | null
  previousCursor: string | null
  pageSize: number
} {
  const trimmed = items.slice(0, pageSize)

  return {
    data: trimmed,
    hasNextPage: opts.hasNextPage ?? trimmed.length === pageSize,
    hasPreviousPage: opts.hasPreviousPage ?? false,
    nextCursor:
      opts.nextCursor ??
      (trimmed.length > 0 ? getCursor(trimmed[trimmed.length - 1]) : null),
    previousCursor:
      opts.previousCursor ??
      (trimmed.length > 0 ? getCursor(trimmed[0]) : null),
    pageSize,
  }
}
