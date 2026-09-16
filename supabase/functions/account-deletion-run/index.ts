// Edge Function: account-deletion-run
//
// Executes approved account deletions whose grace period has elapsed. Two
// callers, and only two:
//
//   * the database, through pg_cron → `private.account_deletion_kick()` →
//     pg_net, carrying the shared secret in `x-ops-secret`;
//   * an admin pressing "Run now" in the CMS, carrying their JWT.
//
// One run: claim the due rows (`account_deletion_claim`, skip-locked,
// flipped to `processing`), and for each one re-check the blockers the reader
// was checked against when they asked — a membership bought during the grace
// period parks the row as `failed` for an admin to look at — then remove the
// reader's storage objects and the auth user. Deleting `auth.users` cascades
// through `profiles` to everything the reader owned. The request row itself
// has no foreign key and survives as the record that it happened.
//
// The rules (what blocks, how long the grace is) live in the database; this
// function only carries them out.

import { requireAdmin, requireMethod, serviceClient } from '../_shared/auth.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { composeEmail, isDeliverableAddress, loadEmailConfig, sendEmail } from '../_shared/email.ts'
import { fail, failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'

const MAX_ROWS = 20

type Blocker = { code: string; message: string }

type ClaimedRow = {
  id: string
  userId: string
  email: string | null
  blockers: Blocker[]
}

type Outcome = { id: string; userId: string; outcome: 'completed' | 'failed'; error?: string }

async function removeAvatars(userId: string): Promise<void> {
  const admin = serviceClient()
  const { data: objects, error } = await admin.storage.from('avatars').list(userId, { limit: 1000 })
  if (error) {
    throw new Error(`avatars list failed: ${error.message}`)
  }
  const paths = (objects ?? []).map((o: { name: string }) => `${userId}/${o.name}`)
  if (paths.length === 0) return
  const { error: removeError } = await admin.storage.from('avatars').remove(paths)
  if (removeError) {
    throw new Error(`avatars remove failed: ${removeError.message}`)
  }
}

async function deleteOne(row: ClaimedRow): Promise<Outcome> {
  if (row.blockers.length > 0) {
    const first = row.blockers[0]
    return {
      id: row.id,
      userId: row.userId,
      outcome: 'failed',
      error: `${first.code}: ${first.message}`,
    }
  }

  const admin = serviceClient()

  try {
    await removeAvatars(row.userId)
  } catch (error) {
    // Storage is best-effort but not silent: a stuck bucket must not leave a
    // reader's identity in place, and must not be forgotten either.
    console.warn(`[account-deletion-run] ${row.userId}: ${(error as Error).message}`)
  }

  const { error } = await admin.auth.admin.deleteUser(row.userId)
  if (error) {
    // Already gone (a previous run died after this step) counts as done.
    const status = (error as { status?: number }).status
    const alreadyGone = status === 404 || /not found/i.test(error.message)
    if (!alreadyGone) {
      return {
        id: row.id,
        userId: row.userId,
        outcome: 'failed',
        error: `auth delete failed: ${error.message}`,
      }
    }
  }

  // Only now is "your account has been deleted" true, so only now is it sent.
  // Nothing here needs the profile: the address was captured on the request
  // row when the reader asked, and the audit row below keeps user_id null so
  // it is not swept away by the cascade that just ran. A run that dies between
  // the delete and this send is picked up by the next tick, which sees the
  // 404 above and lands here again; the idempotency key stops the duplicate.
  await sendFarewell(admin, row)

  return { id: row.id, userId: row.userId, outcome: 'completed' }
}

async function sendFarewell(
  admin: ReturnType<typeof serviceClient>,
  row: ClaimedRow,
): Promise<void> {
  if (!isDeliverableAddress(row.email)) return

  const to = row.email.trim()
  const config = loadEmailConfig()
  let providerId: string | null = null
  let sendError: string | null = null

  if (config) {
    const outcome = await sendEmail(
      config,
      to,
      composeEmail('account_deletion_completed', {
        userId: row.userId,
        requestId: row.id,
        fullName: null,
      }),
      `account-deletion-completed-${row.id}`,
    )
    if (outcome.ok) {
      providerId = outcome.providerId
    } else {
      sendError = outcome.code
      console.warn(`[account-deletion-run] farewell mail ${row.id}: ${outcome.code}`)
    }
  }

  // The audit row is the only record that the letter went (or why it did
  // not). Losing it silently would leave support unable to answer "did you
  // tell me?", so a failed insert is at least logged.
  const { error } = await admin.from('email_outbox').insert({
    user_id: null,
    to_email: to,
    kind: 'account_deletion_completed',
    data: { userId: row.userId, requestId: row.id },
    status: providerId ? 'sent' : config ? 'failed' : 'skipped',
    attempts: 1,
    provider_id: providerId,
    last_error: sendError ?? (config ? null : 'RESEND_NOT_CONFIGURED'),
    processed_at: new Date().toISOString(),
  })
  if (error) {
    console.error(`[account-deletion-run] farewell audit row ${row.id}: ${error.message}`)
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    // Either the database's shared secret or an admin's session.
    const expectedSecret = Deno.env.get('ACCOUNT_DELETION_SECRET')
    const presented = req.headers.get('x-ops-secret')
    let actor: { id: string | null; email: string | null } = { id: null, email: null }

    if (presented) {
      if (!expectedSecret) {
        return fail('OPS_CONFIG_ERROR', 'ACCOUNT_DELETION_SECRET is not configured', 500)
      }
      if (!timingSafeEqualString(presented, expectedSecret)) {
        return fail('OPS_AUTH_FAILED', 'Invalid ops secret', 401)
      }
    } else {
      const ctx = await requireAdmin(req)
      if (ctx instanceof Response) return ctx
      actor = { id: ctx.user.id, email: ctx.user.email ?? null }
    }

    const admin = serviceClient(actor.id ? { id: actor.id, email: actor.email } : undefined)

    const { data: claimed, error: claimError } = await admin.rpc('account_deletion_claim', {
      p_limit: MAX_ROWS,
    })
    if (claimError) {
      return failFromDbError(
        'account-deletion-run',
        'ACCOUNT_DELETION_CLAIM_FAILED',
        'Unable to claim deletion requests',
        claimError,
        500,
      )
    }

    const rows = ((claimed ?? []) as ClaimedRow[]).map((r) => ({
      ...r,
      blockers: Array.isArray(r.blockers) ? r.blockers : [],
    }))

    const outcomes: Outcome[] = []
    for (const row of rows) {
      const outcome = await deleteOne(row)
      const { error: markError } = await admin.rpc('account_deletion_mark', {
        p_request_id: outcome.id,
        p_outcome: outcome.outcome,
        p_error: outcome.error ?? null,
      })
      if (markError) {
        console.error(`[account-deletion-run] mark ${outcome.id} failed: ${markError.message}`)
      }
      outcomes.push(outcome)
    }

    return ok({
      claimed: rows.length,
      completed: outcomes.filter((o) => o.outcome === 'completed').length,
      failed: outcomes.filter((o) => o.outcome === 'failed').length,
      outcomes: outcomes.map((o) => ({ id: o.id, outcome: o.outcome, error: o.error ?? null })),
    })
  } catch (error) {
    return handleError('account-deletion-run', error)
  }
})
