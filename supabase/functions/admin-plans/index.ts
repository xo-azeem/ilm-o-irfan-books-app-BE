import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'

// plans-list is the app's view and only ever returns is_active = true. The CMS
// needs the inactive and retired plans too - that is the whole difference
// between this endpoint and the public one - plus the entitlement count, so an
// operator can see what a plan is still attached to before touching it.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    const { data, count, error } = await ctx.admin
      .from('admin_plan_rows')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError('admin-plans', 'ADMIN_PLANS_READ_FAILED', 'Unable to load plans', error)
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return handleError('admin-plans', error)
  }
})
