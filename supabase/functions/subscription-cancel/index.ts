// Edge Function: subscription-cancel
//
// The reader's "cancel my membership". Records the request and answers with
// the state the app renders next; the app then opens the store's own
// manage-subscriptions sheet, because the App Store and Google Play are the
// only parties that can stop a subscription renewing. The store confirms by
// webhook (revenuecat-webhook, CANCELLATION → status 'cancelled'), access runs
// to expires_at — the period already paid for — and the reader is emailed.
//
// The rule (what may be cancelled, what a request means) lives in
// request_subscription_cancellation(); this is the HTTP shape of it. The app
// also calls the RPC directly when this function is not deployed.

import { requireMethod, requireUser } from '../_shared/auth.ts'
import { fail, failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'
import { MANAGE_URLS } from '../_shared/email.ts'

// The RPC raises its refusal codes as the error message with the sentence in
// details. They are the app's contract, so they pass through unchanged.
const REFUSALS: Record<string, { status: number; message: string }> = {
  NO_SUBSCRIPTION: {
    status: 409,
    message: 'There is no active membership on this account to cancel.',
  },
  NOT_STORE_MANAGED: {
    status: 409,
    message:
      'This membership is not billed through the App Store or Google Play. Contact support to make changes.',
  },
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    // Runs as the caller: the RPC resolves auth.uid() itself and cannot be
    // pointed at another reader.
    const { data, error } = await ctx.supabase.rpc('request_subscription_cancellation')

    if (error) {
      const code = (error.message ?? '').trim()
      const refusal = REFUSALS[code]
      if (refusal) {
        return fail(code, (error.details ?? '').trim() || refusal.message, refusal.status)
      }
      return failFromDbError(
        'subscription-cancel',
        'CANCELLATION_FAILED',
        'Unable to record the cancellation. Please try again.',
        error,
      )
    }

    const state = (data ?? {}) as Record<string, unknown>
    const store = typeof state.store === 'string' ? state.store : null

    return ok({
      ...state,
      // Where the app sends the reader to finish. The native sheet is
      // preferred on-device; this is the fallback when it cannot open.
      manageUrl: store ? MANAGE_URLS[store] ?? null : null,
    })
  } catch (error) {
    return handleError('subscription-cancel', error)
  }
})
