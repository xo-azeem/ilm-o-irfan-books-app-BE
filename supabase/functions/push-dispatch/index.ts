// Edge Function: push-dispatch
//
// Drains `push_outbox` into FCM. Called by the database itself — a pg_net POST
// from the outbox's insert trigger, and a minutely pg_cron tick — with the
// shared secret from `private.runtime_config`. Never by the app.
//
// One run: claim the due rows (`push_outbox_claim`, skip-locked), look up the
// tokens for every user they name, compose each notification, send with
// bounded concurrency, then write back what happened. Tokens FCM reports as
// dead are disabled so the next run does not pay for them again. A run that
// dies mid-way leaves rows in `processing`; the claim takes those back after
// ten minutes.
//
// No CORS: this is server-to-server, like revenuecat-webhook.

import { serviceClient } from '../_shared/auth.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { fail, failFromDbError, handleError, ok } from '../_shared/http.ts'
import { loadServiceAccount, sendMessage, type FcmMessage, type SendOutcome } from '../_shared/fcm.ts'
import {
  composePush,
  LIBRARY_KINDS,
  MEMBERSHIP_KINDS,
  pushData,
  type PushContent,
  type PushFacts,
  type PushKind,
} from '../_shared/push.ts'

const NO_CORS = { cors: false } as const

// How much one run bites off. Fifty rows is a generous minute for this
// catalogue; a bulk delete that names thousands of readers still goes out in
// one run because the per-row fan-out is what dominates, and that is bounded
// by the concurrency below rather than by this.
const MAX_EVENTS = 50
const CONCURRENCY = 16
const MAX_ATTEMPTS = 5
const TOKEN_LOOKUP_CHUNK = 200

type OutboxRow = {
  id: number
  kind: PushKind
  audience: 'topic' | 'users'
  topic: string | null
  recipients: string[]
  entity_id: string | null
  data: PushFacts
  count: number
  attempts: number
}

type TokenRow = {
  token: string
  user_id: string
  platform: 'android' | 'ios'
  notify_library: boolean
  notify_membership: boolean
}

type Send = {
  eventIds: number[]
  token: string | null
  message: FcmMessage
}

type Tally = { sent: number; failed: number; retryable: boolean; lastError: string | null }

function buildMessage(
  target: { token: string } | { topic: string },
  kind: PushKind,
  content: PushContent,
  count: number,
  collapseKey: string,
): FcmMessage {
  return {
    ...target,
    notification: { title: content.title, body: content.body },
    data: pushData(kind, content, count),
    android: {
      priority: content.priority,
      collapse_key: collapseKey,
      notification: {
        channel_id: content.channel,
        tag: collapseKey,
        sound: 'default',
      },
    },
    apns: {
      headers: {
        'apns-priority': content.priority === 'high' ? '10' : '5',
        'apns-collapse-id': collapseKey.slice(0, 64),
      },
      payload: {
        aps: {
          sound: 'default',
          'thread-id': content.channel,
        },
      },
    },
  }
}

function tokenAllows(row: TokenRow, kind: PushKind): boolean {
  if (LIBRARY_KINDS.has(kind)) return row.notify_library
  if (MEMBERSHIP_KINDS.has(kind)) return row.notify_membership
  return true
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

    const expectedSecret = Deno.env.get('PUSH_DISPATCH_SECRET')
    if (!expectedSecret) {
      return fail('PUSH_CONFIG_ERROR', 'PUSH_DISPATCH_SECRET is not configured', 500, NO_CORS)
    }
    if (!timingSafeEqualString(req.headers.get('x-push-secret'), expectedSecret)) {
      return fail('PUSH_AUTH_FAILED', 'Invalid dispatch secret', 401, NO_CORS)
    }

    // Checked before anything is claimed: a missing key must leave the rows
    // pending for the run after it is fixed, not burn an attempt on each.
    const serviceAccount = loadServiceAccount()
    if (!serviceAccount) {
      return fail(
        'PUSH_CONFIG_ERROR',
        'FCM_SERVICE_ACCOUNT_B64 (or FCM_SERVICE_ACCOUNT_JSON) is missing or invalid',
        500,
        NO_CORS,
      )
    }

    const admin = serviceClient()

    const { data: claimed, error: claimError } = await admin.rpc('push_outbox_claim', {
      p_limit: MAX_EVENTS,
    })
    if (claimError) {
      return failFromDbError('push-dispatch', 'PUSH_CLAIM_FAILED', 'Unable to claim outbox rows', claimError, 500, NO_CORS)
    }

    const events = (claimed ?? []) as OutboxRow[]
    if (events.length === 0) {
      return ok({ claimed: 0, sent: 0, failed: 0, skipped: 0, disabledTokens: 0 }, 200, {}, NO_CORS)
    }

    // ── Tokens for every reader any claimed row names ─────────────────────
    const userIds = [...new Set(events.filter((e) => e.audience === 'users').flatMap((e) => e.recipients))]
    const tokensByUser = new Map<string, TokenRow[]>()

    for (let i = 0; i < userIds.length; i += TOKEN_LOOKUP_CHUNK) {
      const chunk = userIds.slice(i, i + TOKEN_LOOKUP_CHUNK)
      const { data: rows, error } = await admin
        .from('device_push_tokens')
        .select('token,user_id,platform,notify_library,notify_membership')
        .in('user_id', chunk)
        .is('disabled_at', null)
      if (error) {
        return failFromDbError('push-dispatch', 'PUSH_TOKENS_FAILED', 'Unable to read device tokens', error, 500, NO_CORS)
      }
      for (const row of (rows ?? []) as TokenRow[]) {
        const list = tokensByUser.get(row.user_id)
        if (list) list.push(row)
        else tokensByUser.set(row.user_id, [row])
      }
    }

    // ── Compose the sends ─────────────────────────────────────────────────
    const sends: Send[] = []
    const tally = new Map<number, Tally>()
    for (const e of events) tally.set(e.id, { sent: 0, failed: 0, retryable: false, lastError: null })

    // Topic rows: one request reaches everyone.
    for (const e of events) {
      if (e.audience !== 'topic' || !e.topic) continue
      const content = composePush(e.kind, e.data ?? {}, e.count)
      sends.push({
        eventIds: [e.id],
        token: null,
        message: buildMessage({ topic: e.topic }, e.kind, content, e.count, `${e.kind}:${e.entity_id ?? e.id}`),
      })
    }

    // User rows, grouped per reader and kind: a reader who held three of the
    // books in one bulk delete gets one "3 books were removed", not three.
    const perUserKind = new Map<string, { kind: PushKind; events: OutboxRow[] }>()
    for (const e of events) {
      if (e.audience !== 'users') continue
      for (const userId of e.recipients) {
        const key = `${userId}|${e.kind}`
        const bucket = perUserKind.get(key)
        if (bucket) bucket.events.push(e)
        else perUserKind.set(key, { kind: e.kind, events: [e] })
      }
    }

    for (const [key, { kind, events: group }] of perUserKind) {
      const userId = key.slice(0, key.indexOf('|'))
      const tokens = (tokensByUser.get(userId) ?? []).filter((t) => tokenAllows(t, kind))
      if (tokens.length === 0) continue

      const total = group.reduce((sum, e) => sum + Math.max(1, e.count), 0)
      const facts: PushFacts = group.length === 1 ? (group[0]!.data ?? {}) : { count: total }
      const content = composePush(kind, facts, group.length === 1 ? group[0]!.count : total)
      const collapseKey =
        group.length === 1 ? `${kind}:${group[0]!.entity_id ?? group[0]!.id}` : `${kind}:many`
      const eventIds = group.map((e) => e.id)

      for (const t of tokens) {
        sends.push({
          eventIds,
          token: t.token,
          message: buildMessage({ token: t.token }, kind, content, total, collapseKey),
        })
      }
    }

    // ── Send ──────────────────────────────────────────────────────────────
    const deadTokens = new Map<string, string>()

    await runWithConcurrency(sends, CONCURRENCY, async (send) => {
      let outcome: SendOutcome
      try {
        outcome = await sendMessage(serviceAccount, send.message)
      } catch (error) {
        outcome = {
          ok: false,
          status: 0,
          code: `THROW:${(error as Error)?.message ?? 'unknown'}`.slice(0, 120),
          retryable: true,
          tokenInvalid: false,
        }
      }

      for (const id of send.eventIds) {
        const t = tally.get(id)
        if (!t) continue
        if (outcome.ok) {
          t.sent += 1
        } else {
          t.failed += 1
          t.lastError = outcome.code
          if (outcome.retryable) t.retryable = true
        }
      }

      if (!outcome.ok && outcome.tokenInvalid && send.token) {
        deadTokens.set(send.token, outcome.code)
      }
    })

    // ── Write back ────────────────────────────────────────────────────────
    const now = new Date()
    let sentRows = 0
    let failedRows = 0
    let skippedRows = 0

    for (const e of events) {
      const t = tally.get(e.id)!
      const eventHadTargets = e.audience === 'topic' || sends.some((s) => s.eventIds.includes(e.id))

      let status: 'sent' | 'failed' | 'skipped' | 'pending'
      let deliverAfter: string | null = null

      if (!eventHadTargets) {
        // Nobody to tell — every recipient has since signed out or turned
        // this kind off. Not a failure.
        status = 'skipped'
        skippedRows += 1
      } else if (t.sent > 0) {
        status = 'sent'
        sentRows += 1
      } else if (t.retryable && e.attempts < MAX_ATTEMPTS) {
        status = 'pending'
        deliverAfter = new Date(now.getTime() + backoffMinutes(e.attempts) * 60_000).toISOString()
      } else {
        status = 'failed'
        failedRows += 1
      }

      const { error } = await admin
        .from('push_outbox')
        .update({
          status,
          sent_count: t.sent,
          failed_count: t.failed,
          last_error: t.lastError,
          processed_at: status === 'pending' ? null : now.toISOString(),
          ...(deliverAfter ? { deliver_after: deliverAfter } : {}),
        })
        .eq('id', e.id)

      if (error) {
        console.error('[push-dispatch] outbox write-back failed', e.id, error.code, error.message)
      }
    }

    if (deadTokens.size > 0) {
      const { error } = await admin
        .from('device_push_tokens')
        .update({ disabled_at: now.toISOString(), disabled_reason: 'fcm:unregistered' })
        .in('token', [...deadTokens.keys()])
      if (error) {
        console.error('[push-dispatch] token disable failed', error.code, error.message)
      }
    }

    return ok(
      {
        claimed: events.length,
        sent: sentRows,
        failed: failedRows,
        skipped: skippedRows,
        requests: sends.length,
        disabledTokens: deadTokens.size,
      },
      200,
      {},
      NO_CORS,
    )
  } catch (error) {
    return handleError('push-dispatch', error, NO_CORS)
  }
})
