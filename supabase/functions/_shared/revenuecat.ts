// RevenueCat event decoding.
//
// Split out of the webhook handler so the state machine can be tested without a
// database, a network, or a signed request. The handler keeps the I/O; every
// rule about what an event *means* lives here.

export const RC_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RcEvent = {
  id?: string
  type?: string
  app_user_id?: string
  entitlement_ids?: string[]
  product_id?: string
  store?: string
  expiration_at_ms?: number | null
  purchased_at_ms?: number | null
  event_timestamp_ms?: number | null
}

export type EntitlementStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'grace'
  | 'billing_issue'
  | 'trial'

export function isUuid(value: string): boolean {
  return RC_UUID_RE.test(value.trim())
}

// RevenueCat's store names are not the values entitlements.store accepts.
export const STORE_MAP: Record<string, string> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
  STRIPE: 'stripe',
  PROMOTIONAL: 'promotional',
}

export function mapStore(store: string | null | undefined): string {
  return STORE_MAP[(store ?? '').toUpperCase()] ?? 'unknown'
}

const ACTIVE_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT',
])

const EXPIRED_EVENT_TYPES = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED'])

// CANCELLATION means "will not renew", not "access ends now" - a reader who
// cancels on day 2 of a month keeps the month. Anything unrecognised falls
// through to 'expired': an unknown event must never be the reason someone gets
// premium for free.
export function mapStatus(
  eventType: string,
  hasPremium: boolean,
  expirationAtMs: number | null | undefined,
  now: number = Date.now(),
): EntitlementStatus {
  if (ACTIVE_EVENT_TYPES.has(eventType) && hasPremium) {
    return 'active'
  }

  if (eventType === 'BILLING_ISSUE') {
    return 'billing_issue'
  }

  if (eventType === 'CANCELLATION') {
    return expirationAtMs != null && expirationAtMs > now ? 'cancelled' : 'expired'
  }

  if (EXPIRED_EVENT_TYPES.has(eventType)) {
    return 'expired'
  }

  return 'expired'
}

// An event that names entitlement_ids must include `premium` to grant.
// Missing/empty ids on purchase/renewal require a product_id (RC sometimes
// omits the list). Pure account-lifecycle types without ids still grant so
// expiry/cancel/billing still apply.
const ACCOUNT_LEVEL_WITHOUT_IDS = new Set([
  'EXPIRATION',
  'CANCELLATION',
  'BILLING_ISSUE',
  'TRANSFER',
  'SUBSCRIBER_ALIAS',
  'SUBSCRIPTION_PAUSED',
  'UNCANCELLATION',
])

export function grantsEntitlement(event: RcEvent, entitlementId: string): boolean {
  const ids = event.entitlement_ids
  if (ids && ids.length > 0) {
    return ids.includes(entitlementId)
  }

  const type = (event.type ?? '').toUpperCase()
  if (ACCOUNT_LEVEL_WITHOUT_IDS.has(type)) {
    return true
  }

  // Purchase-like events with no entitlement list: only grant if a product id is present.
  return Boolean(typeof event.product_id === 'string' && event.product_id.trim())
}

// event_timestamp_ms is what orders two events against each other. Sandbox
// payloads sometimes omit it, so purchased_at_ms is the documented fallback;
// with neither there is no safe ordering and the event is rejected.
export function resolveEventTimestampMs(event: RcEvent): number | null {
  const candidates = [event.event_timestamp_ms, event.purchased_at_ms]

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return null
}

/** Default plan when the event has no product_id or the SKU is not in `plans`. */
export const FALLBACK_PLAN_CODE = 'premium_monthly'

export type PlanProductColumn =
  | 'app_store_product_id'
  | 'play_store_product_id'
  | 'revenuecat_product_id'

export type PlanLookup =
  | { by: 'product_id'; value: string; columns: PlanProductColumn[] }
  | { by: 'code'; value: typeof FALLBACK_PLAN_CODE }

/**
 * Column order for matching `event.product_id` against `plans`.
 * App Store / Play SKUs often differ; Apple Pay and Google Pay are payment
 * methods inside those stores, not separate product ids.
 *
 * A known store never falls back to the *other* store's column. The two are
 * independent namespaces, so a match there is a coincidence, not the plan the
 * reader bought - and the cost of believing it is entitling someone to the
 * wrong plan. `revenuecat_product_id` stays in every list: it is the shared
 * alias, and it is what a catalogue that has not split its SKUs still uses.
 * An unknown store has nothing better to go on, so it tries all three.
 */
export function preferredPlanProductColumns(
  store: string | null | undefined,
): PlanProductColumn[] {
  const mapped = mapStore(store)
  if (mapped === 'app_store') {
    return ['app_store_product_id', 'revenuecat_product_id']
  }
  if (mapped === 'play_store') {
    return ['play_store_product_id', 'revenuecat_product_id']
  }
  return ['revenuecat_product_id', 'app_store_product_id', 'play_store_product_id']
}

/**
 * Prefer matching store-specific plan SKUs to the store/RC product id.
 * Fall back to the single v1 plan code when the event omits product_id.
 * The webhook still falls back to `premium_monthly` if no SKU row matches.
 */
export function resolvePlanLookup(
  productId: string | null | undefined,
  store?: string | null,
): PlanLookup {
  const trimmed = typeof productId === 'string' ? productId.trim() : ''
  if (trimmed) {
    return {
      by: 'product_id',
      value: trimmed,
      columns: preferredPlanProductColumns(store),
    }
  }
  return { by: 'code', value: FALLBACK_PLAN_CODE }
}
