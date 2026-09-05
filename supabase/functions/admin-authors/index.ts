import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'

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
      .from('admin_author_rows')
      .select('*', { count: 'exact' })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError(
        'admin-authors',
        'ADMIN_AUTHORS_READ_FAILED',
        'Unable to load authors',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return handleError('admin-authors', error)
  }
})
