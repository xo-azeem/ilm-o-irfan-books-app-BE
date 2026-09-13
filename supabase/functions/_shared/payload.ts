// Helpers for building partial updates.
//
// The bug this exists to prevent: writing
//
//   { phone: payload.phone ?? null, city: payload.city ?? null, ... }
//
// turns a PATCH of one field into a full overwrite that nulls everything the
// caller did not send. `pickProvided` only emits keys the caller actually sent,
// so an edit-name screen cannot wipe an address.

import { BadRequestError } from './http.ts'

export type FieldSpec = {
  // Column to write.
  column: string
  // Accepted request keys, in priority order (snake_case and camelCase).
  aliases: string[]
  // Optional coercion/validation. Throw BadRequestError to reject.
  coerce?: (value: unknown) => unknown
}

export function pickProvided(
  payload: Record<string, unknown>,
  fields: FieldSpec[],
): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  for (const field of fields) {
    const key = field.aliases.find((alias) => Object.hasOwn(payload, alias))

    if (key === undefined) {
      continue
    }

    const raw = payload[key]
    update[field.column] = field.coerce ? field.coerce(raw) : raw
  }

  return update
}

export function asOptionalText(label: string) {
  return (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    if (typeof value !== 'string') {
      throw new BadRequestError(`${label} must be a string`)
    }

    return value.trim()
  }
}

/** Accepts YYYY-MM-DD or null/empty to clear. */
export function asOptionalDate(label: string) {
  return (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    if (typeof value !== 'string') {
      throw new BadRequestError(`${label} must be a date string (YYYY-MM-DD)`)
    }

    const trimmed = value.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestError(`${label} must be YYYY-MM-DD`)
    }

    // Date.parse rolls an impossible day over ("1995-02-30" becomes 2 March),
    // so the value only counts as a real date if it survives the round trip.
    // Without this Postgres rejected it and the caller got a 500, not a 400.
    const ms = Date.parse(`${trimmed}T00:00:00.000Z`)
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== trimmed) {
      throw new BadRequestError(`${label} must be a valid calendar date`)
    }

    return trimmed
  }
}

/** Accepts an ISO-8601 timestamp or null/empty to clear. */
export function asOptionalTimestamp(label: string) {
  return (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    if (typeof value !== 'string') {
      throw new BadRequestError(`${label} must be an ISO-8601 timestamp string`)
    }

    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) {
      throw new BadRequestError(`${label} must be a valid ISO-8601 timestamp`)
    }

    // Normalised to UTC so a client that sends a local offset and one that
    // sends Z end up with the same instant in the column.
    return new Date(ms).toISOString()
  }
}

/**
 * One of a fixed set, or null to clear. Unlike the query-string filters — where
 * an unknown value is ignored so old and new app builds interoperate — an
 * unknown value here is a 400: this is an admin writing a column with a CHECK
 * constraint, and silently dropping their input would look like a save that
 * worked.
 */
export function asOptionalEnum(label: string, allowed: readonly string[]) {
  return (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    if (typeof value !== 'string') {
      throw new BadRequestError(`${label} must be a string`)
    }

    const normalized = value.trim().toLowerCase()

    if (!allowed.includes(normalized)) {
      throw new BadRequestError(`${label} must be one of: ${allowed.join(', ')}`)
    }

    return normalized
  }
}

export function asBoolean(label: string) {
  return (value: unknown): boolean => {
    if (typeof value === 'boolean') {
      return value
    }

    if (value === 'true' || value === 1 || value === '1') {
      return true
    }

    if (value === 'false' || value === 0 || value === '0') {
      return false
    }

    throw new BadRequestError(`${label} must be a boolean`)
  }
}

export function asInteger(label: string, opts: { min?: number; max?: number } = {}) {
  return (value: unknown): number => {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new BadRequestError(`${label} must be an integer`)
    }

    if (opts.min !== undefined && parsed < opts.min) {
      throw new BadRequestError(`${label} must be >= ${opts.min}`)
    }

    if (opts.max !== undefined && parsed > opts.max) {
      throw new BadRequestError(`${label} must be <= ${opts.max}`)
    }

    return parsed
  }
}

export function asOptionalInteger(label: string, opts: { min?: number; max?: number } = {}) {
  const inner = asInteger(label, opts)

  return (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    return inner(value)
  }
}

export function asUuid(label: string) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  return (value: unknown): string => {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestError(`${label} must be a valid UUID`)
    }

    return value
  }
}

export function asOptionalUuid(label: string) {
  const inner = asUuid(label)

  return (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    return inner(value)
  }
}

export function asStringArray(label: string) {
  return (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new BadRequestError(`${label} must be an array of strings`)
    }

    return value as string[]
  }
}

// Reads a required id from the body under any of the usual key spellings.
export function requireUuidField(
  payload: Record<string, unknown>,
  aliases: string[],
  label: string,
): string {
  const key = aliases.find((alias) => payload[alias] !== undefined && payload[alias] !== null)

  if (key === undefined) {
    throw new BadRequestError(`${label} is required`)
  }

  return asUuid(label)(payload[key])
}

export function asUuidArray(label: string) {
  const inner = asUuid(`${label} item`)

  return (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      throw new BadRequestError(`${label} must be an array of UUIDs`)
    }

    if (value.length === 0) {
      throw new BadRequestError(`${label} must not be empty`)
    }

    return value.map((item) => inner(item))
  }
}

/** Empty array allowed; omit/null → null (for optional relation clears). */
export function asOptionalUuidArray(label: string) {
  const item = asUuid(`${label} item`)

  return (value: unknown): string[] | null => {
    if (value === null || value === undefined) {
      return null
    }

    if (!Array.isArray(value)) {
      throw new BadRequestError(`${label} must be an array of UUIDs`)
    }

    return value.map((entry) => item(entry))
  }
}

export function requireUuidArrayField(
  payload: Record<string, unknown>,
  aliases: string[],
  label: string,
): string[] {
  const key = aliases.find((alias) => payload[alias] !== undefined && payload[alias] !== null)

  if (key === undefined) {
    throw new BadRequestError(`${label} is required`)
  }

  return asUuidArray(label)(payload[key])
}
