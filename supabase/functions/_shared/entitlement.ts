// Subscription access, as the Edge Functions see it.
//
// There is deliberately no copy of the access rule in this file. The rule is
// public.entitlement_has_access() in SQL, reached through user_access_state()
// / my_access_state(), because two implementations of "may this reader open a
// book" is exactly how the trial and cancelled-but-paid-for cases got locked
// out last time. What lives here is the shape of the answer, the channel
// naming both ends agree on, and the signed-URL clamp.

export type AccessReason =
  | 'admin'
  | 'active'
  | 'trial'
  | 'cancelled_paid_through'
  | 'grace'
  | 'billing_issue_paid_through'
  | 'expired'
  | 'lapsed'
  | 'none'

export type AccessState = {
  userId: string
  status: string | null
  startsAt: string | null
  expiresAt: string | null
  isActive: boolean
  isAdmin: boolean
  canAccessPremium: boolean
  reason: AccessReason
  serverTime: string
  secondsRemaining: number | null
}

// One private Realtime topic per reader. The RLS policy on realtime.messages
// pins a reader to exactly this string, so both ends must build it the same
// way - hence one function rather than two template literals.
export function entitlementChannel(userId: string): string {
  return `entitlement:${userId}`
}

export const ENTITLEMENT_EVENT = 'entitlement_changed'

// A signed URL must not outlive the subscription that justified it.
//
// The default TTL is 300s. Handing a full 300s URL to someone whose membership
// ends in 10 seconds grants 290 seconds of reading they did not pay for, and
// unlike the app's own lock there is nothing to revoke - the URL is already in
// their hands and works from any client.
//
// The floor exists because a 2-second URL is not a usable download; below it,
// the reader is inside their paid time and gets a short but workable window.
// Admins pass secondsRemaining: null and are not clamped.
export const MIN_SIGNED_URL_SECONDS = 15

export function clampSignedUrlTtl(
  defaultTtl: number,
  secondsRemaining: number | null,
): number {
  const base = Number.isFinite(defaultTtl) && defaultTtl > 0 ? Math.floor(defaultTtl) : 300

  if (secondsRemaining == null) return base

  const remaining = Math.max(0, Math.floor(secondsRemaining))

  return Math.max(MIN_SIGNED_URL_SECONDS, Math.min(base, remaining))
}
