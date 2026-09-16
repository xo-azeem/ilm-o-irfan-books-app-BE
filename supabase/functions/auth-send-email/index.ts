// Edge Function: auth-send-email
//
// Supabase Auth Send Email Hook. Auth generates the OTP / token_hash; we only
// compose the branded letter and deliver it through Resend (same transport as
// email-dispatch). Once this Hook is enabled in the Dashboard, Auth does not
// use the built-in mailer for these actions.
//
// Payload is verified with the Hook secret (Standard Webhooks). Never call
// this from the app.
//
// One call can mean two letters: an email change with Secure Email Change on
// sends a code to the current address and another to the new one, and both
// must be confirmed. planAuthHookSends() owns that mapping (and its test);
// this function just sends what it is handed and reports the worst outcome.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import {
  authActionToKind,
  type AuthHookEmailData,
  type AuthHookUser,
  composeEmail,
  loadEmailConfig,
  planAuthHookSends,
  sendEmail,
} from '../_shared/email.ts'
import { fail, handleError } from '../_shared/http.ts'

const NO_CORS = { cors: false } as const

function hookSecret(): string {
  // Dashboard value looks like `v1,whsec_<base64>`. Supabase's Resend example
  // strips the `v1,whsec_` prefix before constructing Webhook.
  const raw = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').trim()
  if (!raw) return ''
  return raw.replace(/^v1,whsec_/, '')
}

// Where /auth/v1/verify actually lives. The hook payload's site_url is the
// app's Site URL, which is the wrong host for that link.
function verifyBaseUrl(): string | null {
  const url = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '')
  return url || null
}

function acknowledged(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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

    let user: AuthHookUser
    let emailData: AuthHookEmailData
    try {
      const wh = new Webhook(secret)
      const verified = wh.verify(payload, headers) as {
        user: AuthHookUser
        email_data: AuthHookEmailData
      }
      user = verified.user ?? {}
      emailData = verified.email_data ?? {}
    } catch {
      return fail('HOOK_AUTH_FAILED', 'Invalid hook signature', 401, NO_CORS)
    }

    const sends = planAuthHookSends(user, emailData, verifyBaseUrl())

    if (sends.length === 0) {
      // Either a notification-only action we do not brand yet, or an action
      // with no deliverable recipient. A deliverable action with no address
      // is Auth's bug, not ours; say so where it can be seen.
      if (authActionToKind(emailData.email_action_type)) {
        return fail('INVALID_REQUEST', 'Missing recipient email', 400, NO_CORS)
      }
      return acknowledged()
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

    // Both letters of an email change are attempted even if the first fails:
    // a retry from Auth re-sends both anyway (idempotency keys make the
    // duplicate harmless), and a partial delivery is better logged than hidden.
    let worst: { code: string; retryable: boolean } | null = null
    for (const send of sends) {
      const outcome = await sendEmail(
        config,
        send.to,
        composeEmail(send.kind, send.facts),
        send.idempotencyKey,
      )
      if (!outcome.ok) {
        console.error(`[auth-send-email] ${send.kind} -> ${send.to}: ${outcome.code}`)
        if (!worst || (outcome.retryable && !worst.retryable)) {
          worst = { code: outcome.code, retryable: outcome.retryable }
        }
      }
    }

    if (worst) {
      return fail('EMAIL_SEND_FAILED', worst.code, worst.retryable ? 503 : 400, NO_CORS)
    }

    return acknowledged()
  } catch (error) {
    return handleError('auth-send-email', error, NO_CORS)
  }
})
