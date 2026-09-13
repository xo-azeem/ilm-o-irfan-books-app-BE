import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asInteger } from '../_shared/payload.ts'
import { resolveTimeZone } from '../_shared/timezone.ts'

// Books per calendar month. The column's CHECK enforces the same range, so a
// value that slips past here is still refused by the database.
const GOAL_MIN = 1
const GOAL_MAX = 100

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    if (payload.target === undefined || payload.target === null) {
      return fail('INVALID_REQUEST', 'target is required', 400)
    }

    const target = asInteger('target', { min: GOAL_MIN, max: GOAL_MAX })(payload.target)

    // Same optional zone as profile-read, so the readingGoal echoed back is
    // the one the screen is already showing.
    const tz = resolveTimeZone(payload.tz ?? payload.timezone ?? payload.timeZone)

    // Written with the caller's JWT: monthly_goal is column-granted to
    // authenticated and profiles_update_own scopes it to the caller's own row.
    const { data: updated, error: updateError } = await ctx.supabase
      .from('profiles')
      .update({ monthly_goal: target })
      .eq('id', ctx.user.id)
      .select('monthly_goal')
      .maybeSingle()

    if (updateError) {
      return failFromDbError(
        'reading-goal-update',
        'READING_GOAL_WRITE_FAILED',
        'Unable to save reading goal',
        updateError,
      )
    }

    if (!updated) {
      return fail('NOT_FOUND', 'Profile not found', 404)
    }

    const { data: record, error: recordError } = await ctx.supabase.rpc('reading_record', {
      p_tz: tz,
    })

    if (recordError) {
      return failFromDbError(
        'reading-goal-update',
        'READING_RECORD_READ_FAILED',
        'Unable to load reading record',
        recordError,
      )
    }

    return ok((record as { readingGoal?: unknown })?.readingGoal ?? null)
  } catch (error) {
    return handleError('reading-goal-update', error)
  }
})
