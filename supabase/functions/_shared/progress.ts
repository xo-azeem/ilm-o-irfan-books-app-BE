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
