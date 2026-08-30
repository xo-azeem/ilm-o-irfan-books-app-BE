import { anonClient } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    const { data, count, error } = await anonClient()
      .from('category_with_counts')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      return failFromDbError(
        'categories-list',
        'CATEGORIES_READ_FAILED',
        'Unable to load categories',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return failUnexpected('categories-list', error)
  }
})
