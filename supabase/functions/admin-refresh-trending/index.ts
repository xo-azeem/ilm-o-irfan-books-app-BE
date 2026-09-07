import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import { asOptionalDate, asOptionalInteger } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    // The draw is normally left alone — it is meant to be the same for
    // everyone until Monday. This is the editorial escape hatch for a week that
    // came up with something that should not be leading the Home screen.
    const week = asOptionalDate('weekStart')(payload.weekStart ?? payload.week_start)
    const pool = asOptionalInteger('pool', { min: 1, max: 200 })(payload.pool)

    const { data, error } = await ctx.supabase.rpc('admin_refresh_trending_week', {
      p_week: week,
      p_pool: pool ?? 30,
    })

    if (error) {
      return failFromRpcError(
        'admin-refresh-trending',
        'ADMIN_TRENDING_REFRESH_FAILED',
        'Unable to redraw trending books',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-refresh-trending', error)
  }
})
