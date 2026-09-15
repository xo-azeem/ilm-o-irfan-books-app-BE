// Edge Function: email-dispatch
//
// Drains `email_outbox` into Resend. Called by the database itself — a pg_net
// POST from the outbox's insert trigger, and a minutely pg_cron tick — with
// the shared secret from `private.runtime_config`. Never by the app.
//
// One run: claim the due rows (`email_outbox_claim`, skip-locked), compose
// each letter from its facts, send with bounded concurrency, then write back
// what happened. A provider outage leaves rows `pending` with a backoff; a
// bad address parks the row as `failed` with the provider's own code. A run
// that dies mid-way leaves rows in `processing`; the claim takes those back
// after ten minutes.
//
// No CORS: this is server-to-server, like push-dispatch.

import { serviceClient } from '../_shared/auth.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { fail, failFromDbError, handleError, ok } from '../_shared/http.ts'
import {
  composeEmail,
  isDeliverableAddress,
  loadEmailConfig,
  sendEmail,
  type EmailFacts,
  type EmailKind,
  type SendOutcome,
} from '../_shared/email.ts'

const NO_CORS = { cors: false } as const

const MAX_ROWS = 50
const CONCURRENCY = 8
const MAX_ATTEMPTS = 5

type OutboxRow = {
  id: number
  user_id: string | null
  to_email: string | null
  kind: EmailKind
  data: EmailFacts | null
  attempts: number
}

type Result = {
  id: number
  status: 'sent' | 'failed' | 'skipped' | 'pending'
  error: string | null
  providerId: string | null
  deliverAfter: string | null
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 405 })
  }

  try {
    if (req.method !== 'POST') {
      return fail('METHOD_NOT_ALLOWED', 'Allowed: POST', 405, NO_CORS)
    }

    const expectedSecret = Deno.env.get('EMAIL_DISPATCH_SECRET')
    if (!expectedSecret) {
      return fail('EMAIL_CONFIG_ERROR', 'EMAIL_DISPATCH_SECRET is not configured', 500, NO_CORS)
    }
    if (!timingSafeEqualString(req.headers.get('x-ops-secret'), expectedSecret)) {
      return fail('EMAIL_AUTH_FAILED', 'Invalid dispatch secret', 401, NO_CORS)
    }

    // Checked before anything is claimed: a missing key must leave the rows
    // pending for the run after it is fixed, not burn an attempt on each.
    const config = loadEmailConfig()
    if (!config) {
      return fail('EMAIL_CONFIG_ERROR', 'RESEND_API_KEY / EMAIL_FROM are not configured', 500, NO_CORS)
    }

    const admin = serviceClient()

    const { data: claimed, error: claimError } = await admin.rpc('email_outbox_claim', {
      p_limit: MAX_ROWS,
    })
    if (claimError) {
      return failFromDbError('email-dispatch', 'EMAIL_CLAIM_FAILED', 'Unable to claim outbox rows', claimError, 500, NO_CORS)
    }

    const rows = (claimed ?? []) as OutboxRow[]
    if (rows.length === 0) {
      return ok({ claimed: 0, sent: 0, failed: 0, skipped: 0, retried: 0 }, 200, {}, NO_CORS)
    }

    const results: Result[] = []
    const now = new Date()

    await runWithConcurrency(rows, CONCURRENCY, async (row) => {
      const to = (row.to_email ?? '').trim()

      // Nobody to write to — the account was deleted, or never had an
      // address. Not a failure, and not worth retrying.
      if (!isDeliverableAddress(to)) {
        results.push({ id: row.id, status: 'skipped', error: 'NO_ADDRESS', providerId: null, deliverAfter: null })
        return
      }

      let outcome: SendOutcome
      try {
        const content = composeEmail(row.kind, row.data ?? {})
        // The row id makes the send idempotent at the provider: a run that
        // dies between the send and the write-back re-claims the row and
        // Resend answers with the original message rather than a duplicate.
        outcome = await sendEmail(config, to, content, `email-outbox-${row.id}-${row.attempts}`)
      } catch (error) {
        outcome = {
          ok: false,
          status: 0,
          code: `THROW:${(error as Error)?.message ?? 'unknown'}`.slice(0, 120),
          retryable: false,
        }
      }

      if (outcome.ok) {
        results.push({ id: row.id, status: 'sent', error: null, providerId: outcome.providerId, deliverAfter: null })
        return
      }

      if (outcome.retryable && row.attempts < MAX_ATTEMPTS) {
        results.push({
          id: row.id,
          status: 'pending',
          error: outcome.code,
          providerId: null,
          deliverAfter: new Date(now.getTime() + backoffMinutes(row.attempts) * 60_000).toISOString(),
        })
        return
      }

      results.push({ id: row.id, status: 'failed', error: outcome.code, providerId: null, deliverAfter: null })
    })

    // ── Write back ────────────────────────────────────────────────────────
    let sent = 0
    let failed = 0
    let skipped = 0
    let retried = 0

    for (const r of results) {
      if (r.status === 'sent') sent += 1
      else if (r.status === 'failed') failed += 1
      else if (r.status === 'skipped') skipped += 1
      else retried += 1

      const { error } = await admin
        .from('email_outbox')
        .update({
          status: r.status,
          last_error: r.error,
          provider_id: r.providerId,
          processed_at: r.status === 'pending' ? null : now.toISOString(),
          ...(r.deliverAfter ? { deliver_after: r.deliverAfter } : {}),
        })
        .eq('id', r.id)

      if (error) {
        console.error('[email-dispatch] outbox write-back failed', r.id, error.code, error.message)
      }
    }

    return ok({ claimed: rows.length, sent, failed, skipped, retried }, 200, {}, NO_CORS)
  } catch (error) {
    return handleError('email-dispatch', error, NO_CORS)
  }
})
