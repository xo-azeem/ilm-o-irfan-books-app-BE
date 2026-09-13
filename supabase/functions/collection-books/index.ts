import { anonClient, requireMethod } from '../_shared/auth.ts'
import { asCollectionPage, fetchCollectionPage } from '../_shared/collections.ts'
import { withCoverUrls } from '../_shared/covers.ts'
import {
  CATALOGUE_CACHE_SECONDS,
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  list,
  publicCache,
} from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

// One RPC does what used to be three round trips (collection, membership,
// books), and it is the same RPC home-feed builds its rails from, so the page
// behind "See all" is the rail continued rather than a different list.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const url = new URL(req.url)
    const idParam = (url.searchParams.get('id') ?? '').trim()
    const slugParam = (url.searchParams.get('slug') ?? '').trim()

    if (!idParam && !slugParam) {
      return fail('INVALID_REQUEST', 'id or slug is required', 400)
    }

    if (idParam && slugParam) {
      return fail('INVALID_REQUEST', 'Pass id or slug, not both', 400)
    }

    const { page, pageSize, from } = rangeFromRequest(req)
    const ref = idParam ? { id: asUuid('id')(idParam) } : { slug: slugParam }

    const { data, error } = await fetchCollectionPage(anonClient(), ref, from, pageSize)

    if (error) {
      return failFromDbError(
        'collection-books',
        'COLLECTION_READ_FAILED',
        'Unable to load collection books',
        error,
      )
    }

    const result = asCollectionPage(data)

    if (!result) {
      return fail('NOT_FOUND', 'Collection not found', 404)
    }

    // A page past the end is the last call of every "load more" loop: an empty
    // page with the true count, never an error.
    return list({
      ...paginate(withCoverUrls(result.books), result.totalCount, page, pageSize),
      collection: result.collection,
      source: result.source,
    }, publicCache(CATALOGUE_CACHE_SECONDS))
  } catch (error) {
    return handleError('collection-books', error)
  }
})
