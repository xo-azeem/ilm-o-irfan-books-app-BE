import { anonClient, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok, publicCache } from '../_shared/http.ts'
import { normalizePageSize } from '../_shared/pagination.ts'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

// The draw is fixed until Monday 00:00 UTC, so this could be cached for days.
// Fifteen minutes is the compromise that lets an admin's re-roll actually reach
// the app, and it is already long enough that the database sees a trickle
// rather than one request per app launch.
const CACHE_SECONDS = 900

// Monday 00:00 UTC, matching date_trunc('week') in Postgres. Computed here as
// well as there so the response can carry the window without a second round
// trip; the two must agree, which is why both are UTC and both start Monday.
function weekBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // getUTCDay(): 0 = Sunday. Sunday belongs to the week that began six days ago.
  const daysSinceMonday = (start.getUTCDay() + 6) % 7
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)

  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)

  return { start: start.toISOString(), end: end.toISOString() }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const url = new URL(req.url)
    const limit = normalizePageSize(
      url.searchParams.get('limit') ?? undefined,
      DEFAULT_LIMIT,
      MAX_LIMIT,
    )

    // The RPC seeds the week on its first call of the week and reads the stored
    // picks on every call after that, so this is an indexed ten-row read
    // essentially always.
    const { data, error } = await anonClient().rpc('weekly_trending_books', {
      p_limit: limit,
    })

    if (error) {
      return failFromDbError(
        'trending-weekly',
        'TRENDING_READ_FAILED',
        'Unable to load trending books',
        error,
      )
    }

    const { start, end } = weekBounds()

    return ok(
      {
        weekStart: start,
        // When the current draw stops being current. A client can cache until
        // then instead of polling.
        expiresAt: end,
        books: data ?? [],
      },
      200,
      publicCache(CACHE_SECONDS),
    )
  } catch (error) {
    return handleError('trending-weekly', error)
  }
})
