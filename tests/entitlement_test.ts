import { assertEquals } from 'jsr:@std/assert@1'

import {
  clampSignedUrlTtl,
  ENTITLEMENT_EVENT,
  entitlementChannel,
  MIN_SIGNED_URL_SECONDS,
} from '../supabase/functions/_shared/entitlement.ts'

// The access rule itself is asserted in SQL (scripts/e2e-endpoints.sh, the
// "subscription lifecycle" block) because it lives in
// public.entitlement_has_access and there is deliberately no TypeScript copy
// of it to test. What is testable here is the signed-URL clamp and the
// channel naming, both of which the client depends on exactly.

Deno.test('the channel name is the one the RLS policy pins', () => {
  // realtime.messages allows a reader to join 'entitlement:' || auth.uid()
  // and nothing else, so this string is a contract, not a convention.
  assertEquals(
    entitlementChannel('2f9c1a6e-0f3b-4a54-9c9e-2ad9a7c9d1b2'),
    'entitlement:2f9c1a6e-0f3b-4a54-9c9e-2ad9a7c9d1b2',
  )
  assertEquals(ENTITLEMENT_EVENT, 'entitlement_changed')
})

Deno.test('a signed URL never outlives the subscription that justified it', () => {
  // The whole point: a minted URL cannot be recalled, so it must not be
  // valid for longer than the reader has paid for.
  assertEquals(clampSignedUrlTtl(300, 60), 60)
  assertEquals(clampSignedUrlTtl(300, 120), 120)
})

Deno.test('a comfortable margin is not shortened for no reason', () => {
  // Plenty of time left: the default TTL wins, no clamping.
  assertEquals(clampSignedUrlTtl(300, 86400), 300)
  assertEquals(clampSignedUrlTtl(300, 301), 300)
  assertEquals(clampSignedUrlTtl(300, 300), 300)
})

Deno.test('admins and lifetime comps have no end date to clamp against', () => {
  // null means "no expiry" - an admin or a promotional grant.
  assertEquals(clampSignedUrlTtl(300, null), 300)
  assertEquals(clampSignedUrlTtl(60, null), 60)
})

Deno.test('a URL that expires before the download starts is useless', () => {
  // Inside their paid time but with seconds to spare, the reader still gets a
  // workable window rather than a URL that dies mid-request.
  assertEquals(clampSignedUrlTtl(300, 5), MIN_SIGNED_URL_SECONDS)
  assertEquals(clampSignedUrlTtl(300, 1), MIN_SIGNED_URL_SECONDS)
  assertEquals(clampSignedUrlTtl(300, 0), MIN_SIGNED_URL_SECONDS)
})

Deno.test('a negative remainder cannot produce a negative TTL', () => {
  // The gate refuses a lapsed reader long before this runs, but a clamp that
  // could return a negative number is a Storage error waiting to happen.
  assertEquals(clampSignedUrlTtl(300, -500), MIN_SIGNED_URL_SECONDS)
})

Deno.test('a misconfigured SIGNED_PDF_EXPIRES_IN falls back rather than breaking', () => {
  // Number(undefined) is NaN, and NaN would otherwise propagate into the
  // Storage call as the URL lifetime.
  assertEquals(clampSignedUrlTtl(Number.NaN, null), 300)
  assertEquals(clampSignedUrlTtl(0, null), 300)
  assertEquals(clampSignedUrlTtl(-1, null), 300)
  // ...but a valid remainder still clamps the fallback.
  assertEquals(clampSignedUrlTtl(Number.NaN, 45), 45)
})

Deno.test('fractional seconds do not leak into the TTL', () => {
  // secondsRemaining arrives from JSON; Storage wants a whole number.
  assertEquals(clampSignedUrlTtl(300, 42.9), 42)
  assertEquals(clampSignedUrlTtl(300.7, null), 300)
})
