// Reading-progress input rules.
//
// The scale is fixed by the database: reading_progress.progress is CHECK
// (progress >= 0 and progress <= 1), and admin_user_directory counts a book as
// finished at >= 0.99.
//
// Guessing the scale per request cannot work. `progress: 1` is genuinely
// ambiguous - it is "finished" on a 0-1 scale and "1% read" on a 0-100 scale -
// and the old `value > 1 ? value / 100 : value` heuristic resolved it as
// "finished", marking a book complete for a reader one page in. So the two
// scales get two field names and anything out of range is a 400.

import { BadRequestError } from './http.ts'

export function hasAny(payload: Record<string, unknown>, aliases: string[]): boolean {
  return aliases.some((alias) => Object.hasOwn(payload, alias))
}

// Returns undefined when the caller sent no progress at all, which the RPC
// reads as "leave the stored value alone".
export function resolveProgress(payload: Record<string, unknown>): number | undefined {
  const hasFraction = Object.hasOwn(payload, 'progress')
  const hasPercent = hasAny(payload, ['progress_percent', 'progressPercent'])

  if (hasFraction && hasPercent) {
    throw new BadRequestError('Send either progress (0-1) or progress_percent (0-100), not both')
  }

  if (hasPercent) {
    const raw = payload.progress_percent ?? payload.progressPercent
    const parsed = Number(raw)

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new BadRequestError('progress_percent must be a number between 0 and 100')
    }

    return Number((parsed / 100).toFixed(4))
  }

  if (hasFraction) {
    const parsed = Number(payload.progress)

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new BadRequestError(
        'progress must be a number between 0 and 1. Use progress_percent for a 0-100 value.',
      )
    }

    return Number(parsed.toFixed(4))
  }

  return undefined
}

// How far ahead of the server a client clock may claim to be before the value
// is treated as garbage rather than skew. Phones are NTP-synced; a stamp a day
// out is a bug in the app, and storing it would make every later honest write
// lose the last-write-wins comparison for a day.
export const CLIENT_UPDATED_AT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000

// The reader's own timestamp for the position it is sending, used for
// last-write-wins when an offline queue is replayed out of order. Optional: an
// absent value means "overwrite, stamp with server time", which is what every
// build before the queue existed gets.
//
// Returned normalised to UTC ISO-8601 so the RPC compares instants, not
// strings, and so a client that sends a local offset and one that sends Z end
// up equal when they mean the same moment.
export function resolveClientUpdatedAt(
  payload: Record<string, unknown>,
  now: number = Date.now(),
): string | null {
  const key = ['client_updated_at', 'clientUpdatedAt'].find((alias) =>
    Object.hasOwn(payload, alias)
  )
  if (key === undefined) {
    return null
  }

  const raw = payload[key]
  if (raw === null || raw === undefined || raw === '') {
    return null
  }

  if (typeof raw !== 'string') {
    throw new BadRequestError('client_updated_at must be an ISO-8601 timestamp string')
  }

  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) {
    throw new BadRequestError('client_updated_at must be a valid ISO-8601 timestamp')
  }

  if (ms - now > CLIENT_UPDATED_AT_MAX_FUTURE_MS) {
    throw new BadRequestError('client_updated_at is too far in the future')
  }

  return new Date(ms).toISOString()
}

// The PDF view can report one page past the end for a frame while it settles,
// so exactly one over is clamped to the last page. Anything further is a
// genuine bad request. Only the request pair is checked here; the merged row
// (a current_page sent without total_pages) is checked again inside the RPC.
export function clampCurrentPage(currentPage: number, totalPages: number | null): number {
  if (totalPages === null || currentPage <= totalPages) {
    return currentPage
  }

  if (currentPage === totalPages + 1) {
    return totalPages
  }

  throw new BadRequestError('current_page cannot be greater than total_pages')
}
