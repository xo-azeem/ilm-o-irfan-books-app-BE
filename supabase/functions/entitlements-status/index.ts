import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    // entitlements.user_id is the primary key, so at most one row exists.
    // The profile read is covered by the profiles_select_own policy, so the
    // caller's own client is enough - no service role needed here.
    const [entitlementRes, profileRes] = await Promise.all([
      ctx.supabase
        .from('entitlements')
        .select('*, plan:plans(*)')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),
      ctx.supabase.from('profiles').select('role').eq('id', ctx.user.id).maybeSingle(),
    ])

    if (entitlementRes.error) {
      return failFromDbError(
        'entitlements-status',
        'ENTITLEMENTS_READ_FAILED',
        'Unable to load entitlements',
        entitlementRes.error,
      )
    }

    const data = entitlementRes.data

    // The app should not have to re-derive "is this person premium right now"
    // from status plus an expiry timestamp, so it is answered here.
    const isActive = Boolean(
      data &&
        data.status === 'active' &&
        (data.expires_at == null || new Date(data.expires_at).getTime() > Date.now()),
    )

    const isAdmin =
      ctx.user.app_metadata?.app_role === 'admin' || profileRes.data?.role === 'admin'

    // get-signed-pdf lets admins through regardless of subscription. If the app
    // gated its unlock UI on isActive alone, an admin would see a locked button
    // on a file the backend would happily serve. canAccessPremium is the field
    // to gate on; isActive stays a truthful report of the subscription itself.
    return ok({
      isActive,
      isAdmin,
      canAccessPremium: isActive || isAdmin,
      entitlement: data ?? null,
    })
  } catch (error) {
    return handleError('entitlements-status', error)
  }
})
