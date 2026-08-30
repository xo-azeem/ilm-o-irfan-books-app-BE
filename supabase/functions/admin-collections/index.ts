import { requireAdmin } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    // admin_collection_rows, not collection_summaries: the CMS has to see
    // unpublished collections, which the public view filters out.
    const { data, count, error } = await ctx.admin
      .from('admin_collection_rows')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      return failFromDbError(
        'admin-collections',
        'ADMIN_COLLECTIONS_READ_FAILED',
        'Unable to load collections',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return failUnexpected('admin-collections', error)
  }
})
