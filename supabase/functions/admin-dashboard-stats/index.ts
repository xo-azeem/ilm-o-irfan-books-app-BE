import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const { data, error } = await ctx.supabase.rpc('admin_dashboard_stats')

    if (error) {
      return failFromDbError(
        'admin-dashboard-stats',
        'ADMIN_DASHBOARD_STATS_FAILED',
        'Unable to load dashboard stats',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-dashboard-stats', error)
  }
})
