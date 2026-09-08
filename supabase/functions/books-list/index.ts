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

    const { page, pageSize, from } = rangeFromRequest(req)

    // Browsing is the same query as searching, minus the text term. Sharing
    // catalog_books is what keeps `premium=true` from meaning one thing here
    // and another in books-search.
    //
    // Every filter is applied before LIMIT/OFFSET inside the function, so the
    // page meta below describes the matches, not the page that happened to
    // arrive. That is the whole point of moving these off the phone.
    const args = catalogArgsFromRequest(req, { limit: pageSize, offset: from })

    const { data, error } = await anonClient().rpc('catalog_books', args)

    if (error) {
      // An unknown category slug raises P0002, which failFromRpcError turns
      // into the 404 books-list has always answered with. The app reads that
      // as an empty shelf.
      return failFromRpcError('books-list', 'BOOKS_READ_FAILED', 'Unable to load books', error)
    }

    const { items, totalCount } = splitCatalogRows(data ?? [])

    // A page that starts past the end is an empty page, not a failure: it is
    // the last call of every load-more loop. The RPC returns no rows rather
    // than the PGRST103 that a PostgREST .range() would, so there is nothing
    // to special-case here.
    return list(paginate(withCoverUrls(items), totalCount, page, pageSize))
  } catch (error) {
    return handleError('books-list', error)
  }
})
