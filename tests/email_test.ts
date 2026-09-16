import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'

import {
  authActionToKind,
  composeEmail,
  formatDate,
  isDeliverableAddress,
} from '../supabase/functions/_shared/email.ts'

Deno.test('authActionToKind maps GoTrue action types', () => {
  assertEquals(authActionToKind('signup'), 'auth_signup')
  assertEquals(authActionToKind('recovery'), 'auth_recovery')
  assertEquals(authActionToKind('email_change'), 'auth_email_change')
  assertEquals(authActionToKind('magiclink'), 'auth_magiclink')
  assertEquals(authActionToKind('invite'), 'auth_invite')
  assertEquals(authActionToKind('reauthentication'), 'auth_reauthentication')
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
    siteUrl: 'https://example.supabase.co',
    redirectTo: 'ilmoirfan://auth',
  })
  assertEquals(mail.subject, 'Reset your Ilm o Irfan password')
  assertStringIncludes(mail.text, '123456')
  assertStringIncludes(mail.text, 'Assalamu alaikum Sara')
  assertStringIncludes(mail.html, 'auth/v1/verify')
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
