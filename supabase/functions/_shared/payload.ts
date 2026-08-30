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
