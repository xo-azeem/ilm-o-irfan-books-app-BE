import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'

import { assertNotEquals } from 'jsr:@std/assert@1'

import {
  authActionToKind,
  composeEmail,
  formatDate,
  isDeliverableAddress,
  planAuthHookSends,
} from '../supabase/functions/_shared/email.ts'

Deno.test('authActionToKind maps GoTrue action types', () => {
  assertEquals(authActionToKind('signup'), 'auth_signup')
  assertEquals(authActionToKind('recovery'), 'auth_recovery')
  assertEquals(authActionToKind('email_change'), 'auth_email_change')
  assertEquals(authActionToKind('magiclink'), 'auth_magiclink')
  assertEquals(authActionToKind('invite'), 'auth_invite')
  assertEquals(authActionToKind('reauthentication'), 'auth_reauthentication')
  assertEquals(authActionToKind('email'), 'auth_magiclink')
  assertEquals(authActionToKind('password_changed_notification'), null)
  assertEquals(authActionToKind(''), null)
})

Deno.test('isDeliverableAddress rejects junk', () => {
  assertEquals(isDeliverableAddress('a@b.co'), true)
  assertEquals(isDeliverableAddress('  a@b.co  '), true)
  assertEquals(isDeliverableAddress('not-an-email'), false)
  assertEquals(isDeliverableAddress(null), false)
})

Deno.test('formatDate renders UTC calendar dates', () => {
  assertEquals(formatDate('2026-09-16T12:00:00.000Z'), '16 September 2026')
  assertEquals(formatDate('not-a-date'), null)
  assertEquals(formatDate(null), null)
})

Deno.test('recovery letter includes the OTP', () => {
  const mail = composeEmail('auth_recovery', {
    fullName: 'Sara',
    otp: '123456',
    token: '123456',
    tokenHash: 'abc',
    siteUrl: 'http://127.0.0.1:3000',
    verifyBaseUrl: 'https://example.supabase.co',
    redirectTo: 'ilmoirfan://auth',
  })
  assertEquals(mail.subject, 'Reset your Ilm o Irfan password')
  assertStringIncludes(mail.text, '123456')
  assertStringIncludes(mail.text, 'Assalamu alaikum Sara')
  assertStringIncludes(
    mail.html,
    'https://example.supabase.co/auth/v1/verify?token=abc&amp;type=recovery&amp;redirect_to=ilmoirfan%3A%2F%2Fauth',
  )
})

Deno.test('verify link is never built on the Site URL', () => {
  // site_url in the hook payload is the app, not the API. With no API base
  // the letter carries the code alone rather than a link to a 404.
  const mail = composeEmail('auth_recovery', {
    otp: '123456',
    tokenHash: 'abc',
    siteUrl: 'http://127.0.0.1:3000',
  })
  assertStringIncludes(mail.text, '123456')
  assertEquals(mail.html.includes('127.0.0.1:3000'), false)
  assertEquals(mail.html.includes('auth/v1/verify'), false)
})

Deno.test('hook plan: ordinary actions are one letter to the current address', () => {
  const sends = planAuthHookSends(
    { id: 'u1', email: 'reader@example.com', user_metadata: { full_name: 'Sara' } },
    {
      email_action_type: 'recovery',
      token: '111111',
      token_hash: 'hash-r',
      redirect_to: 'ilmoirfan://auth',
      site_url: 'http://127.0.0.1:3000',
    },
    'https://ref.supabase.co',
  )
  assertEquals(sends.length, 1)
  assertEquals(sends[0].to, 'reader@example.com')
  assertEquals(sends[0].kind, 'auth_recovery')
  assertEquals(sends[0].facts.otp, '111111')
  assertEquals(sends[0].facts.tokenHash, 'hash-r')
  assertEquals(sends[0].facts.verifyBaseUrl, 'https://ref.supabase.co')
  assertEquals(sends[0].facts.fullName, 'Sara')
})

Deno.test('hook plan: notification-only actions send nothing', () => {
  assertEquals(
    planAuthHookSends({ email: 'reader@example.com' }, {
      email_action_type: 'password_changed_notification',
    }, null),
    [],
  )
})

Deno.test('hook plan: secure email change is two letters with the fields crossed', () => {
  // Per the Send Email Hook docs, the names are reversed for backward
  // compatibility: token_hash_new pairs with token for the CURRENT address,
  // token_hash pairs with token_new for the NEW address.
  const sends = planAuthHookSends(
    { id: 'u1', email: 'old@example.com', new_email: 'new@example.com' },
    {
      email_action_type: 'email_change',
      token: '111111',
      token_hash: 'hash-for-new',
      token_new: '222222',
      token_hash_new: 'hash-for-current',
    },
    'https://ref.supabase.co',
  )
  assertEquals(sends.length, 2)

  const toCurrent = sends.find((x) => x.to === 'old@example.com')!
  const toNew = sends.find((x) => x.to === 'new@example.com')!
  assertEquals(toCurrent.facts.otp, '111111')
  assertEquals(toCurrent.facts.tokenHash, 'hash-for-current')
  assertEquals(toCurrent.facts.emailChangeStage, 'current')
  assertEquals(toNew.facts.otp, '222222')
  assertEquals(toNew.facts.tokenHash, 'hash-for-new')
  assertEquals(toNew.facts.emailChangeStage, 'new')
  assertNotEquals(toCurrent.idempotencyKey, toNew.idempotencyKey)

  // And the two letters say different things.
  const current = composeEmail(toCurrent.kind, toCurrent.facts)
  const next = composeEmail(toNew.kind, toNew.facts)
  assertStringIncludes(current.text, 'change the email')
  assertStringIncludes(current.text, 'new@example.com')
  assertStringIncludes(current.text, '111111')
  assertStringIncludes(current.html, 'token=hash-for-current&amp;type=email_change')
  assertStringIncludes(next.subject, 'Confirm your new')
  assertStringIncludes(next.text, '222222')
  assertStringIncludes(next.html, 'token=hash-for-new&amp;type=email_change')
})

Deno.test('hook plan: non-secure email change is one letter to the new address', () => {
  const sends = planAuthHookSends(
    { email: 'old@example.com', new_email: 'new@example.com' },
    { email_action_type: 'email_change', token: '333333', token_hash: 'hash-only' },
    null,
  )
  assertEquals(sends.length, 1)
  assertEquals(sends[0].to, 'new@example.com')
  assertEquals(sends[0].facts.otp, '333333')
  assertEquals(sends[0].facts.tokenHash, 'hash-only')
})

Deno.test('hook plan: an undeliverable address is dropped, not sent to', () => {
  assertEquals(
    planAuthHookSends({ email: 'not-an-email' }, {
      email_action_type: 'signup',
      token: '1',
      token_hash: 'h',
    }, null),
    [],
  )
})

Deno.test('deletion approved letter names the scheduled day', () => {
  const mail = composeEmail('account_deletion_approved', {
    fullName: 'Omar',
    scheduledFor: '2026-10-01T00:00:00.000Z',
    adminNote: 'Confirmed by support',
  })
  assertEquals(mail.subject, 'Account deletion approved')
  assertStringIncludes(mail.text, '1 October 2026')
  assertStringIncludes(mail.text, 'Confirmed by support')
})

Deno.test('deletion completed letter does not promise a refund', () => {
  const mail = composeEmail('account_deletion_completed', {
    requestId: '11111111-1111-1111-1111-111111111111',
  })
  assertEquals(mail.subject, 'Your Ilm o Irfan account has been deleted')
  assertStringIncludes(mail.text, 'RevenueCat')
  assertEquals(/refund/i.test(mail.text), false)
})

Deno.test('deletion requested letter acknowledges the ask', () => {
  const mail = composeEmail('account_deletion_requested', {
    requestId: '22222222-2222-2222-2222-222222222222',
  })
  assertEquals(mail.subject, 'We received your account deletion request')
  assertStringIncludes(mail.text, 'Privacy & security')
})

Deno.test('membership activated welcomes the reader', () => {
  const mail = composeEmail('membership_activated', {
    planName: 'Premium',
    store: 'play_store',
    expiresAt: '2026-11-01T00:00:00.000Z',
  })
  assertEquals(mail.subject, 'Welcome to Premium')
  assertStringIncludes(mail.text, '1 November 2026')
})
