import { anonClient, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, list, publicCache, REFERENCE_CACHE_SECONDS } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    const { data, count, error } = await anonClient()
      .from('collection_summaries')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize), publicCache(REFERENCE_CACHE_SECONDS))
      }

      return failFromDbError(
        'collections-list',
        'COLLECTIONS_READ_FAILED',
        'Unable to load collections',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize), publicCache(REFERENCE_CACHE_SECONDS))
  } catch (error) {
    return handleError('collections-list', error)
  }
})
