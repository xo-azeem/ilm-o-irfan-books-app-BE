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

    const url = new URL(req.url)
    const requested = Number(url.searchParams.get('days') ?? '30')
    // The function clamps to 1..365 itself; clamping here too keeps a garbage
    // query string from reaching the database at all.
    const days = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 365) : 30

    // Two things matter here and both used to be wrong.
    //
    // The parameter is named p_days: PostgREST resolves RPC arguments by name,
    // so sending { days } produced PGRST202 "function not found" on every call.
    //
    // And the call goes through the caller's client, not the service-role
    // client. admin_analytics() is SECURITY DEFINER and gates itself on
    // is_admin(), which reads auth.jwt() / auth.uid(). The service-role key
    // carries neither, so it failed that gate with "not allowed" even for a
    // real admin. requireAdmin above has already authorised this request.
    const { data, error } = await ctx.supabase.rpc('admin_analytics', { p_days: days })

    if (error) {
      return failFromDbError(
        'admin-analytics',
        'ADMIN_ANALYTICS_READ_FAILED',
        'Unable to load analytics',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-analytics', error)
  }
})
