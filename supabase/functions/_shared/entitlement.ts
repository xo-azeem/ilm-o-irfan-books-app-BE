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
  // 20260922120000: which store bills the row, and whether the reader has
  // asked to cancel in the app without the store confirming yet.
  store?: string | null
  cancelRequestedAt?: string | null
  cancelPending?: boolean
}

// How a reader is told their access changed.
//
// This is Postgres Changes on public.access_events, not Realtime Broadcast.
// Broadcast is the better-scaling design and the code for it is still in the
// trigger, but it is undeliverable on the hosted project: realtime.messages is
// partitioned by day, that project has no partitions, and realtime.send()
// downgrades the resulting failure to a warning - so every broadcast vanishes
// silently. Creating partitions needs privileges on the `realtime` schema that
// the postgres role does not have.
//
// access_events is a table we own, carries the same computed payload, and is
// filtered to one reader by RLS.
export const ACCESS_EVENTS_TABLE = 'access_events'
export const ACCESS_EVENTS_SCHEMA = 'public'
export const ACCESS_EVENTS_EVENT = 'INSERT'

// The channel name is the client's own label for the subscription; only the
// filter decides what arrives. Naming it per reader keeps two subscriptions in
// one app from colliding.
export function accessChannel(userId: string): string {
  return `access:${userId}`
}

export function accessFilter(userId: string): string {
  return `user_id=eq.${userId}`
}

// Dormant. Kept so the contract does not have to change again on the day
// Supabase provisions partitions for this project.
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
