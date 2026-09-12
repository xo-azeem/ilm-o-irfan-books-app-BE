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

    // The fallback draw only shows while the admin has no live slides, and the
    // proper fix for a bad draw is to curate the carousel. This is the
    // thirty-second answer while that is being written: redraw the week
    // without waiting for Monday.
    const week = asOptionalDate('weekStart')(payload.weekStart ?? payload.week_start)
    const pool = asOptionalInteger('pool', { min: 1, max: 200 })(payload.pool)

    const { data, error } = await ctx.supabase.rpc('admin_refresh_carousel_week', {
      p_week: week,
      p_pool: pool ?? 15,
    })

    if (error) {
      return failFromRpcError(
        'admin-refresh-carousel',
        'ADMIN_CAROUSEL_REFRESH_FAILED',
        'Unable to redraw the carousel fallback',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-refresh-carousel', error)
  }
})
