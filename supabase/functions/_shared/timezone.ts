// Timezone resolution for the reading record.
//
// A "reading day" and "this month" are calendar concepts, and the calendar
// belongs to the reader, not to the server. Nothing in a JWT says where the
// reader is, so the zone travels with the request:
//
//   tz                 an IANA name ("Asia/Karachi") on profile-read,
//                      reading-goal-update and reading-progress POST.
//   client_updated_at  on reading-progress POST, an ISO-8601 stamp whose
//                      numeric offset ("+05:00") is the reader's zone at the
//                      moment of the read.
//
// The database takes one string per request (an IANA name or a "+HH:MM"
// offset) and falls back to UTC for anything it cannot resolve. These helpers
// produce that string.

import { BadRequestError } from './http.ts'

const OFFSET_RE = /(Z|[+-]\d{2}(?::?\d{2})?)$/i

// Validates an IANA zone name with the runtime's own tz database. Returns null
// when the caller sent nothing; throws on a name the runtime does not know so
// a typo is a 400 rather than a silent UTC.
export function resolveTimeZone(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new BadRequestError('tz must be an IANA time zone name')
  }

  const trimmed = value.trim()

  try {
    // Normalises case ("asia/karachi" -> "Asia/Karachi") and rejects unknown
    // names with a RangeError.
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    throw new BadRequestError('tz must be a valid IANA time zone name (e.g. Asia/Karachi)')
  }
}

// The explicit numeric offset carried by an ISO-8601 stamp, as "+HH:MM", or
// null when the stamp has none worth using. "Z" and "+00:00" count as none:
// JavaScript's toISOString() emits Z whatever the device zone, so a Z says
// nothing about where the reader is, and the caller's tz should decide.
export function offsetFromIso(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const match = OFFSET_RE.exec(raw.trim())
  if (!match || match[1].toUpperCase() === 'Z') {
    return null
  }

  const sign = match[1][0]
  const digits = match[1].slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 14 || minutes > 59) {
    return null
  }

  if (hours === 0 && minutes === 0) {
    return null
  }

  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// The zone a reading-progress write is recorded under, in priority order:
// the client_updated_at offset, then the tz field, then null (UTC in the
// database). Both inputs are read straight from the request body.
export function resolveWriteTimeZone(payload: Record<string, unknown>): string | null {
  const stampKey = ['client_updated_at', 'clientUpdatedAt'].find((alias) =>
    Object.hasOwn(payload, alias)
  )
  const fromStamp = stampKey === undefined ? null : offsetFromIso(payload[stampKey])
  if (fromStamp !== null) {
    return fromStamp
  }

  return resolveTimeZone(payload.tz ?? payload.timezone ?? payload.timeZone)
}
