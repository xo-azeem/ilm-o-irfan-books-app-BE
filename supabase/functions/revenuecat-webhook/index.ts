// Edge Function: revenuecat-webhook
// Shared secret → validate event → idempotent ledger → order-safe entitlement upsert.
// Clients never write entitlements.

import { requireMethod, serviceClient } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RcEvent = {
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

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

function mapStatus(
  eventType: string,
  hasPremium: boolean,
  expirationAtMs: number | null | undefined,
): string {
  const activeEventTypes = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
    'NON_RENEWING_PURCHASE',
    'TEMPORARY_ENTITLEMENT_GRANT',
  ])

  const expiredEventTypes = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED'])

  if (activeEventTypes.has(eventType) && hasPremium) {
    return 'active'
  }
  if (eventType === 'BILLING_ISSUE') {
    return 'billing_issue'
  }
  if (eventType === 'CANCELLATION') {
    return expirationAtMs != null && expirationAtMs > Date.now() ? 'cancelled' : 'expired'
  }
  if (expiredEventTypes.has(eventType)) {
    return 'expired'
  }
  return 'expired'
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')
    const entitlementId = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'premium'

    if (!expectedAuth) {
      return fail('WEBHOOK_CONFIG_ERROR', 'Webhook authorization is not configured', 500)
    }

    const auth = req.headers.get('Authorization')
    if (auth !== expectedAuth) {
      return fail('WEBHOOK_AUTH_FAILED', 'Invalid webhook authorization', 401)
    }

    const payload = await readJsonBody(req)
    const event = (payload.event ?? payload) as RcEvent

    const eventIdRaw = typeof event.id === 'string' ? event.id.trim() : ''
    if (!eventIdRaw || !isUuid(eventIdRaw)) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing or invalid event id', 400)
    }

    const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id.trim() : ''
    if (!appUserId || !isUuid(appUserId)) {
      return fail(
        'INVALID_WEBHOOK_EVENT',
        'Missing or invalid app_user_id (must be Supabase Auth UUID)',
        400,
      )
    }

    const eventType = (event.type ?? '').toUpperCase()
    if (!eventType) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing event type', 400)
    }

    const eventTimestampMs =
      typeof event.event_timestamp_ms === 'number' && Number.isFinite(event.event_timestamp_ms)
        ? event.event_timestamp_ms
        : typeof event.purchased_at_ms === 'number' && Number.isFinite(event.purchased_at_ms)
          ? event.purchased_at_ms
          : null

    if (eventTimestampMs == null) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing event_timestamp_ms', 400)
    }

    const eventTimestamp = new Date(eventTimestampMs).toISOString()
    const admin = serviceClient()

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .eq('id', appUserId)
      .maybeSingle()

    if (profileError) {
      return failFromDbError(
        'revenuecat-webhook',
        'USER_LOOKUP_FAILED',
        'Unable to verify user',
        profileError,
      )
    }

    if (!profile) {
      return fail('USER_NOT_FOUND', 'No profile for app_user_id', 400)
    }

    // Idempotency ledger — unique event id. Duplicate → 200 without re-applying.
    const { error: insertEventError } = await admin.from('revenuecat_events').insert({
      id: eventIdRaw,
      user_id: appUserId,
      event_type: eventType,
      event_timestamp: eventTimestamp,
      raw_event: payload,
    })

    if (insertEventError) {
      if (insertEventError.code === '23505') {
        return ok({ duplicate: true, eventId: eventIdRaw, userId: appUserId })
      }
      return failFromDbError(
        'revenuecat-webhook',
        'EVENT_LEDGER_WRITE_FAILED',
        'Unable to record webhook event',
        insertEventError,
      )
    }

    const hasPremiumEntitlement =
      !event.entitlement_ids ||
      event.entitlement_ids.length === 0 ||
      event.entitlement_ids.includes(entitlementId)

    const status = mapStatus(eventType, hasPremiumEntitlement, event.expiration_at_ms)

    const storeMap: Record<string, string> = {
      APP_STORE: 'app_store',
      MAC_APP_STORE: 'app_store',
      PLAY_STORE: 'play_store',
      STRIPE: 'stripe',
      PROMOTIONAL: 'promotional',
    }

    const { data: plan, error: planError } = await admin
      .from('plans')
      .select('id')
      .eq('code', 'premium_monthly')
      .maybeSingle()

    if (planError) {
      return failFromDbError(
        'revenuecat-webhook',
        'PLAN_LOOKUP_FAILED',
        'Unable to load plan',
        planError,
      )
    }

    const { data: applyResult, error: applyError } = await admin.rpc(
      'apply_revenuecat_entitlement',
      {
        p_user_id: appUserId,
        p_plan_id: plan?.id ?? null,
        p_status: status,
        p_starts_at: event.purchased_at_ms
          ? new Date(event.purchased_at_ms).toISOString()
          : new Date().toISOString(),
        p_expires_at:
          event.expiration_at_ms != null ? new Date(event.expiration_at_ms).toISOString() : null,
        p_store: storeMap[event.store ?? ''] ?? 'unknown',
        p_revenuecat_entitlement_id: entitlementId,
        p_raw_event: payload,
        p_event_id: eventIdRaw,
        p_event_at: eventTimestamp,
      },
    )

    if (applyError) {
      return failFromDbError(
        'revenuecat-webhook',
        'ENTITLEMENT_WRITE_FAILED',
        'Unable to update entitlement',
        applyError,
      )
    }

    const applied = applyResult?.applied === true
    if (!applied) {
      return ok({
        stale: true,
        ignored: true,
        eventId: eventIdRaw,
        userId: appUserId,
        reason: applyResult?.reason ?? 'stale',
      })
    }

    return ok({
      eventId: eventIdRaw,
      userId: appUserId,
      status: applyResult?.status ?? status,
      applied: true,
    })
  } catch (error) {
    return failUnexpected('revenuecat-webhook', error)
  }
})
