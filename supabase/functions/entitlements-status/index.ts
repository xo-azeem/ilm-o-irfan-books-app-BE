// Edge Function: entitlements-status
//
// The one endpoint the app asks "may this reader open a book right now", and
// the fallback it polls whenever its Realtime socket is down.
//
// The access rule itself is NOT here. It lives in public.entitlement_has_access
// and is reached through my_access_state(), so this endpoint and get-signed-pdf
// cannot drift apart - they used to, and the drift silently locked out anyone
// on a trial or inside a cancelled-but-paid-for month.

import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'
import { entitlementChannel, ENTITLEMENT_EVENT, type AccessState } from '../_shared/entitlement.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    // my_access_state() resolves auth.uid() itself, so it cannot be pointed at
    // another reader. entitlements.user_id is the primary key, so the row read
    // returns at most one.
    const [stateRes, entitlementRes] = await Promise.all([
      ctx.supabase.rpc('my_access_state'),
      ctx.supabase
        .from('entitlements')
        .select('*, plan:plans(*)')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),
    ])

    if (stateRes.error) {
      return failFromDbError(
        'entitlements-status',
        'ENTITLEMENTS_READ_FAILED',
        'Unable to load entitlements',
        stateRes.error,
      )
    }

    if (entitlementRes.error) {
      return failFromDbError(
        'entitlements-status',
        'ENTITLEMENTS_READ_FAILED',
        'Unable to load entitlements',
        entitlementRes.error,
      )
    }

    const state = stateRes.data as AccessState | null

    if (!state) {
      // my_access_state() returns null only when auth.uid() is null, which
      // requireUser already ruled out. Treating it as a 500 rather than as
      // "no access" keeps a broken JWT path from looking like a lapsed
      // subscription in the app.
      return failFromDbError(
        'entitlements-status',
        'ENTITLEMENTS_READ_FAILED',
        'Unable to resolve access state',
        { message: 'my_access_state returned null for an authenticated caller' },
      )
    }

    return ok({
      // Unchanged fields. The app has always gated on canAccessPremium.
      isActive: state.isActive,
      isAdmin: state.isAdmin,
      canAccessPremium: state.canAccessPremium,
      entitlement: entitlementRes.data ?? null,

      // The subscription's own end date. This is what the client counts down
      // to, and it is the only thing that ends access - status alone does not.
      status: state.status,
      startsAt: state.startsAt,
      expiresAt: state.expiresAt,
      secondsRemaining: state.secondsRemaining,

      // Why, so the app can tell "your card failed" apart from "you never
      // subscribed" without inferring it from status and a timestamp.
      reason: state.reason,

      // The client runs the countdown that actually locks the screen, so it
      // needs to know how far its own clock is off. Without this a device
      // whose clock is dragged backwards earns itself free reading time.
      serverTime: state.serverTime,

      // Named here so the client does not hardcode the topic convention. If
      // the channel is ever renamed, apps already in the field follow.
      realtime: {
        channel: entitlementChannel(ctx.user.id),
        event: ENTITLEMENT_EVENT,
        private: true,
      },
    })
  } catch (error) {
    return handleError('entitlements-status', error)
  }
})
