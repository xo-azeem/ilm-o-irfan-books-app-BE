import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCoverUrls } from '../_shared/covers.ts'
import { failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'

type SearchRow = Record<string, unknown> & { total_count?: number | string | null }

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const url = new URL(req.url)
    const query = (url.searchParams.get('q') ?? '').trim()
    const { page, pageSize, from } = rangeFromRequest(req)

    const empty = paginate([], 0, page, pageSize)

    if (!query) {
      return list(empty)
    }

    // search_books() runs websearch_to_tsquery against the GIN-indexed
    // search_vector, which covers title, author, description, genre and tags.
    // Sanitising is the database's job here - the query text is a bound
    // parameter, never string-concatenated into a filter.
    const { data, error } = await anonClient().rpc('search_books', {
      p_query: query,
      p_limit: pageSize,
      p_offset: from,
    })

    if (error) {
      return failFromDbError('books-search', 'SEARCH_FAILED', 'Search failed', error)
    }

    const rows = (data ?? []) as SearchRow[]

    if (rows.length === 0) {
      return list(empty)
    }

    // Every row carries the same window count; strip it from the payload.
    const totalCount = Number(rows[0].total_count ?? 0)
    const items = withCoverUrls(
      rows.map(({ total_count: _ignored, ...book }) => book as Record<string, unknown>),
    )

    return list(paginate(items, Number.isFinite(totalCount) ? totalCount : null, page, pageSize))
  } catch (error) {
    return handleError('books-search', error)
  }
})
