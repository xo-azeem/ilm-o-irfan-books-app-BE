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
import {
  ACCESS_EVENTS_EVENT,
  ACCESS_EVENTS_SCHEMA,
  ACCESS_EVENTS_TABLE,
  accessChannel,
  accessFilter,
  type AccessState,
} from '../_shared/entitlement.ts'

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
        .select(
          [
            'user_id',
            'plan_id',
            'status',
            'starts_at',
            'expires_at',
            'store',
            'cancel_requested_at',
            'created_at',
            'updated_at',
            'plan:plans(id, code, name, price_cents, currency, interval, features, is_active)',
          ].join(','),
        )
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

      // The cancel flow. `store` names the sheet the app opens; a pending
      // request is one the reader made in the app that the store has not
      // confirmed by webhook yet, so the membership still renews.
      store: state.store ?? null,
      cancelRequestedAt: state.cancelRequestedAt ?? null,
      cancelPending: state.cancelPending ?? false,

      // The client runs the countdown that actually locks the screen, so it
      // needs to know how far its own clock is off. Without this a device
      // whose clock is dragged backwards earns itself free reading time.
      serverTime: state.serverTime,

      // Named here so the client does not hardcode the subscription. If the
      // delivery mechanism is ever changed again, apps already in the field
      // follow without a release.
      //
      // Postgres Changes rather than Broadcast: realtime.messages has no
      // partitions on the hosted project, so realtime.send() drops every
      // message with a warning and the device is never told. See
      // _shared/entitlement.ts.
      realtime: {
        mode: 'postgres_changes',
        channel: accessChannel(ctx.user.id),
        schema: ACCESS_EVENTS_SCHEMA,
        table: ACCESS_EVENTS_TABLE,
        event: ACCESS_EVENTS_EVENT,
        filter: accessFilter(ctx.user.id),
      },
    })
  } catch (error) {
    return handleError('entitlements-status', error)
  }
})
