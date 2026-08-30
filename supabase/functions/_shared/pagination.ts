export type PaginationParams = {
  page?: number | string
  pageSize?: number | string
  defaultPage?: number
  defaultPageSize?: number
  maxPageSize?: number
}

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
