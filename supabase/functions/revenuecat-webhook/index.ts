// Edge Function: revenuecat-webhook
// Shared secret → validate event → idempotent ledger → order-safe entitlement upsert.
// Clients never write entitlements.
//
// No CORS: RevenueCat is a server caller, not a browser.

import { serviceClient } from '../_shared/auth.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import {
  fail,
  failFromDbError,
  handleError,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  FALLBACK_PLAN_CODE,
  grantsEntitlement,
  isUuid,
  mapStatus,
  mapStore,
  resolveEventTimestampMs,
  resolvePlanLookup,
  type RcEvent,
} from '../_shared/revenuecat.ts'

const NO_CORS = { cors: false } as const
const WEBHOOK_MAX_BYTES = 256 * 1024

Deno.serve(async (req) => {
  // Reject browser preflight — this endpoint is not for browsers.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 405 })
  }

  try {
    if (req.method !== 'POST') {
      return fail('METHOD_NOT_ALLOWED', 'Allowed: POST', 405, NO_CORS)
    }

    const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')
    const entitlementId = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'premium'

    if (!expectedAuth) {
      return fail('WEBHOOK_CONFIG_ERROR', 'Webhook authorization is not configured', 500, NO_CORS)
    }

    const auth = req.headers.get('Authorization')
    if (!timingSafeEqualString(auth, expectedAuth)) {
      return fail('WEBHOOK_AUTH_FAILED', 'Invalid webhook authorization', 401, NO_CORS)
    }

    const payload = await readJsonBody(req, { maxBytes: WEBHOOK_MAX_BYTES })
    const event = (payload.event ?? payload) as RcEvent

    const eventIdRaw = typeof event.id === 'string' ? event.id.trim() : ''
    if (!eventIdRaw || !isUuid(eventIdRaw)) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing or invalid event id', 400, NO_CORS)
    }

    const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id.trim() : ''
    if (!appUserId || !isUuid(appUserId)) {
      return fail(
        'INVALID_WEBHOOK_EVENT',
        'Missing or invalid app_user_id (must be Supabase Auth UUID)',
        400,
        NO_CORS,
      )
    }

    const eventType = (event.type ?? '').toUpperCase()
    if (!eventType) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing event type', 400, NO_CORS)
    }

    const eventTimestampMs = resolveEventTimestampMs(event)

    if (eventTimestampMs == null) {
      return fail('INVALID_WEBHOOK_EVENT', 'Missing event_timestamp_ms', 400, NO_CORS)
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
        500,
        NO_CORS,
      )
    }

    if (!profile) {
      return fail('USER_NOT_FOUND', 'No profile for app_user_id', 400, NO_CORS)
    }

    // Idempotency ledger — unique event id.
    // If apply failed after a prior insert, RC retries hit 23505; we re-drive
    // apply when entitlements.last_revenuecat_event_id is not yet this event.
    let isDuplicateLedger = false
    const { error: insertEventError } = await admin.from('revenuecat_events').insert({
      id: eventIdRaw,
      user_id: appUserId,
      event_type: eventType,
      event_timestamp: eventTimestamp,
      raw_event: payload,
    })

    if (insertEventError) {
      if (insertEventError.code === '23505') {
        isDuplicateLedger = true
        const { data: existing, error: existingError } = await admin
          .from('entitlements')
          .select('last_revenuecat_event_id')
          .eq('user_id', appUserId)
          .maybeSingle()

        if (existingError) {
          return failFromDbError(
            'revenuecat-webhook',
            'ENTITLEMENT_WRITE_FAILED',
            'Unable to verify prior entitlement apply',
            existingError,
            500,
            NO_CORS,
          )
        }

        if (existing?.last_revenuecat_event_id === eventIdRaw) {
          return ok({ duplicate: true, eventId: eventIdRaw, userId: appUserId }, 200, {}, NO_CORS)
        }
        // Fall through and re-apply — ledger row exists but entitlement never committed.
      } else {
        return failFromDbError(
          'revenuecat-webhook',
          'EVENT_LEDGER_WRITE_FAILED',
          'Unable to record webhook event',
          insertEventError,
          500,
          NO_CORS,
        )
      }
    }

    const hasPremiumEntitlement = grantsEntitlement(event, entitlementId)
    const status = mapStatus(eventType, hasPremiumEntitlement, event.expiration_at_ms)

    const planLookup = resolvePlanLookup(event.product_id)
    let plan: { id: string } | null = null
    let planError: { message?: string; code?: string } | null = null

    if (planLookup.by === 'revenuecat_product_id') {
      const byProduct = await admin
        .from('plans')
        .select('id')
        .eq('revenuecat_product_id', planLookup.value)
        .maybeSingle()
      planError = byProduct.error
      plan = byProduct.data
    }

    if (!planError && !plan) {
      const byCode = await admin
        .from('plans')
        .select('id')
        .eq('code', FALLBACK_PLAN_CODE)
        .maybeSingle()
      planError = byCode.error
      plan = byCode.data
    }

    if (planError) {
      return failFromDbError(
        'revenuecat-webhook',
        'PLAN_LOOKUP_FAILED',
        'Unable to load plan',
        planError,
        500,
        NO_CORS,
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
        p_store: mapStore(event.store),
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
        500,
        NO_CORS,
      )
    }

    const applied = applyResult?.applied === true
    if (!applied) {
      return ok(
        {
          stale: true,
          ignored: true,
          eventId: eventIdRaw,
          userId: appUserId,
          reason: applyResult?.reason ?? 'stale',
          replayed: isDuplicateLedger,
        },
        200,
        {},
        NO_CORS,
      )
    }

    return ok(
      {
        eventId: eventIdRaw,
        userId: appUserId,
        status: applyResult?.status ?? status,
        store: mapStore(event.store),
        planId: plan?.id ?? null,
        applied: true,
        replayed: isDuplicateLedger,
      },
      200,
      {},
      NO_CORS,
    )
  } catch (error) {
    return handleError('revenuecat-webhook', error, NO_CORS)
  }
})
