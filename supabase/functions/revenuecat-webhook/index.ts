// Edge Function: revenuecat-webhook
// Shared secret → validate event → idempotent ledger → order-safe entitlement upsert.
// Clients never write entitlements.

import { requireMethod, serviceClient } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
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

    const eventTimestampMs = resolveEventTimestampMs(event)

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

    const hasPremiumEntitlement = grantsEntitlement(event, entitlementId)

    const status = mapStatus(eventType, hasPremiumEntitlement, event.expiration_at_ms)

    // Prefer plans.revenuecat_product_id = event.product_id (App Store / Play SKU).
    // Unknown or missing SKU → premium_monthly so a single-plan launch still applies.
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
      store: mapStore(event.store),
      planId: plan?.id ?? null,
      applied: true,
    })
  } catch (error) {
    return handleError('revenuecat-webhook', error)
  }
})
