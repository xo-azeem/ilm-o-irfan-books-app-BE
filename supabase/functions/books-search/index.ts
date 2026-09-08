import { anonClient, requireMethod } from '../_shared/auth.ts'
import { catalogArgsFromRequest, splitCatalogRows } from '../_shared/catalog-filters.ts'
import { withCoverUrls } from '../_shared/covers.ts'
import { handleError, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const url = new URL(req.url)
    const query = (url.searchParams.get('q') ?? '').trim()
    const { page, pageSize, from } = rangeFromRequest(req)

    // No term is still an empty result, as it always has been: the app switches
    // to books-list the moment the field is cleared, and returning the whole
    // catalogue here would change that contract underneath it.
    if (!query) {
      return list(paginate([], 0, page, pageSize))
    }

    // Same function as books-list, so `category`, `premium`, `minRating`,
    // `language`, `length` and `sort` behave identically whether or not the
    // reader has typed. `category` in particular used to be silently dropped
    // here, so searching inside a subject ignored the subject.
    const args = catalogArgsFromRequest(req, { query, limit: pageSize, offset: from })

    const { data, error } = await anonClient().rpc('catalog_books', args)

    if (error) {
      return failFromRpcError('books-search', 'SEARCH_FAILED', 'Search failed', error)
    }

    const { items, totalCount } = splitCatalogRows(data ?? [])

    return list(paginate(withCoverUrls(items), totalCount, page, pageSize))
  } catch (error) {
    return handleError('books-search', error)
  }
})
