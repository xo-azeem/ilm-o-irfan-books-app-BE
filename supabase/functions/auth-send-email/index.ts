// Edge Function: auth-send-email
//
// Supabase Auth Send Email Hook. Auth generates the OTP / token_hash; we only
// compose the branded letter and deliver it through Resend (same transport as
// email-dispatch). Once this Hook is enabled in the Dashboard, Auth does not
// use the built-in mailer for these actions.
//
// Payload is verified with the Hook secret (Standard Webhooks). Never call
// this from the app.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import {
  authActionToKind,
  composeEmail,
  isDeliverableAddress,
  loadEmailConfig,
  sendEmail,
  type EmailFacts,
} from '../_shared/email.ts'
import { fail, handleError } from '../_shared/http.ts'

const NO_CORS = { cors: false } as const

type HookUser = {
  id?: string
  email?: string
  user_metadata?: { full_name?: string; name?: string }
}

type HookEmailData = {
  token?: string
  token_hash?: string
  redirect_to?: string
  email_action_type?: string
  site_url?: string
  token_new?: string
  token_hash_new?: string
}

function hookSecret(): string {
  // Dashboard value looks like `v1,whsec_<base64>`. Supabase's Resend example
  // strips the `v1,whsec_` prefix before constructing Webhook.
  const raw = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').trim()
  if (!raw) return ''
  return raw.replace(/^v1,whsec_/, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 405 })
  }

  try {
    if (req.method !== 'POST') {
      return fail('METHOD_NOT_ALLOWED', 'Allowed: POST', 405, NO_CORS)
    }

    const secret = hookSecret()
    if (!secret) {
      return fail('HOOK_CONFIG_ERROR', 'SEND_EMAIL_HOOK_SECRET is not configured', 500, NO_CORS)
    }

    const payload = await req.text()
    const headers = Object.fromEntries(req.headers)

    let user: HookUser
    let emailData: HookEmailData
    try {
      const wh = new Webhook(secret)
      const verified = wh.verify(payload, headers) as {
        user: HookUser
        email_data: HookEmailData
      }
      user = verified.user
      emailData = verified.email_data
    } catch {
      return fail('HOOK_AUTH_FAILED', 'Invalid hook signature', 401, NO_CORS)
    }

    const to = (user.email ?? '').trim()
    if (!isDeliverableAddress(to)) {
      return fail('INVALID_REQUEST', 'Missing recipient email', 400, NO_CORS)
    }

    const kind = authActionToKind(emailData.email_action_type)
    if (!kind) {
      // Notification-only types we do not brand yet — acknowledge so Auth stops.
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const config = loadEmailConfig()
    if (!config) {
      return fail(
        'EMAIL_CONFIG_ERROR',
        'RESEND_API_KEY / EMAIL_FROM are not configured',
        500,
        NO_CORS,
      )
    }

    const fullName =
      (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').trim() || null

    const facts: EmailFacts = {
      userId: user.id,
      fullName,
      otp: emailData.token ?? null,
      token: emailData.token ?? null,
      tokenHash: emailData.token_hash ?? null,
      redirectTo: emailData.redirect_to ?? null,
      siteUrl: emailData.site_url ?? null,
      emailActionType: emailData.email_action_type ?? null,
    }

    const content = composeEmail(kind, facts)
    const idempotencyKey = [
      'auth-send-email',
      kind,
      user.id ?? to,
      (emailData.token_hash ?? emailData.token ?? '').slice(0, 24),
    ].join('-')

    const outcome = await sendEmail(config, to, content, idempotencyKey)
    if (!outcome.ok) {
      return fail(
        'EMAIL_SEND_FAILED',
        outcome.code,
        outcome.retryable ? 503 : 400,
        NO_CORS,
      )
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return handleError('auth-send-email', error, NO_CORS)
  }
})
