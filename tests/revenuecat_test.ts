import { assertEquals } from 'jsr:@std/assert@1'

import {
  FALLBACK_PLAN_CODE,
  grantsEntitlement,
  isUuid,
  mapStatus,
  mapStore,
  resolveEventTimestampMs,
  resolvePlanLookup,
} from '../supabase/functions/_shared/revenuecat.ts'

const NOW = Date.parse('2026-09-05T00:00:00.000Z')
const FUTURE = NOW + 30 * 24 * 60 * 60 * 1000
const PAST = NOW - 30 * 24 * 60 * 60 * 1000

Deno.test('app_user_id must be a Supabase Auth UUID', () => {
  assertEquals(isUuid('2f9c1a6e-0f3b-4a54-9c9e-2ad9a7c9d1b2'), true)
  assertEquals(isUuid('  2f9c1a6e-0f3b-4a54-9c9e-2ad9a7c9d1b2  '), true)
  assertEquals(isUuid('$RCAnonymousID:abc123'), false, 'anonymous RC ids are not accepted')
  assertEquals(isUuid('user@example.com'), false)
  assertEquals(isUuid(''), false)
})

Deno.test('purchase and renewal events grant access', () => {
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']) {
    assertEquals(mapStatus(type, true, FUTURE, NOW), 'active', type)
  }
})

Deno.test('an event for some other entitlement never grants premium', () => {
  assertEquals(mapStatus('INITIAL_PURCHASE', false, FUTURE, NOW), 'expired')
})

// A reader who cancels mid-term keeps what they paid for; RC sends EXPIRATION
// when the term actually ends.
Deno.test('cancellation keeps access until the paid term ends', () => {
  assertEquals(mapStatus('CANCELLATION', true, FUTURE, NOW), 'cancelled')
  assertEquals(mapStatus('CANCELLATION', true, PAST, NOW), 'expired')
  assertEquals(mapStatus('CANCELLATION', true, null, NOW), 'expired')
})

Deno.test('billing issues are their own state, not an expiry', () => {
  assertEquals(mapStatus('BILLING_ISSUE', true, FUTURE, NOW), 'billing_issue')
})

Deno.test('expiry and pause end access', () => {
  assertEquals(mapStatus('EXPIRATION', true, PAST, NOW), 'expired')
  assertEquals(mapStatus('SUBSCRIPTION_PAUSED', true, FUTURE, NOW), 'expired')
})

// The rule that matters if RevenueCat ships a new event type: an unrecognised
// event must never be the reason someone gets premium for free.
Deno.test('an unknown event type falls back to expired', () => {
  assertEquals(mapStatus('SOMETHING_NEW', true, FUTURE, NOW), 'expired')
  assertEquals(mapStatus('', true, FUTURE, NOW), 'expired')
})

Deno.test('store names are mapped onto the values the column accepts', () => {
  assertEquals(mapStore('APP_STORE'), 'app_store')
  assertEquals(mapStore('MAC_APP_STORE'), 'app_store')
  assertEquals(mapStore('play_store'), 'play_store')
  assertEquals(mapStore('PROMOTIONAL'), 'promotional')
  assertEquals(mapStore('SOME_NEW_STORE'), 'unknown')
  assertEquals(mapStore(null), 'unknown')
})

Deno.test('an account-wide event with no entitlement_ids counts as premium', () => {
  assertEquals(grantsEntitlement({}, 'premium'), true)
  assertEquals(grantsEntitlement({ entitlement_ids: [] }, 'premium'), true)
  assertEquals(grantsEntitlement({ entitlement_ids: ['premium'] }, 'premium'), true)
  assertEquals(grantsEntitlement({ entitlement_ids: ['audio_only'] }, 'premium'), false)
})

Deno.test('event ordering falls back to purchased_at_ms, then gives up', () => {
  assertEquals(resolveEventTimestampMs({ event_timestamp_ms: 10, purchased_at_ms: 20 }), 10)
  assertEquals(resolveEventTimestampMs({ purchased_at_ms: 20 }), 20)
  assertEquals(resolveEventTimestampMs({}), null)
  assertEquals(resolveEventTimestampMs({ event_timestamp_ms: null }), null)
  assertEquals(resolveEventTimestampMs({ event_timestamp_ms: Number.NaN }), null)
})

Deno.test('plan lookup prefers store product_id, else premium_monthly', () => {
  assertEquals(resolvePlanLookup('com.ilmoirfan.premium.monthly'), {
    by: 'revenuecat_product_id',
    value: 'com.ilmoirfan.premium.monthly',
  })
  assertEquals(resolvePlanLookup('  premium_monthly  '), {
    by: 'revenuecat_product_id',
    value: 'premium_monthly',
  })
  assertEquals(resolvePlanLookup(''), { by: 'code', value: FALLBACK_PLAN_CODE })
  assertEquals(resolvePlanLookup(null), { by: 'code', value: FALLBACK_PLAN_CODE })
  assertEquals(resolvePlanLookup(undefined), { by: 'code', value: FALLBACK_PLAN_CODE })
})
