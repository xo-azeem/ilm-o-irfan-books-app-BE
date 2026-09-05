// Postgres error codes -> HTTP.
//
// The admin CMS RPCs are the authority on their own rules ("a category with
// books cannot be deleted", "kind must be hero/shelf/carousel"), and they say
// so by raising with a SQLSTATE. Without this mapping every one of those became
// a 500, so a caller could not tell a typo from an outage.
//
// The RPCs are called with the caller's own JWT rather than the service-role
// key, so is_admin() sees the real user and private.audit_write() records who
// made the change.

import { fail, failFromDbError } from './http.ts'

export type PostgrestErrorLike = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

// Messages raised by our own RPCs are written for operators and name no schema
// internals, so the cases below pass them through. Anything else falls back to
// the generic message and is logged server-side only.
export function failFromRpcError(
  scope: string,
  fallbackCode: string,
  fallbackMessage: string,
  error: PostgrestErrorLike | null,
): Response {
  const raw = error?.message ?? ''

  switch (error?.code) {
    // raise ... using errcode = '42501', or a plain `raise exception 'not allowed'`
    case '42501':
      return fail('FORBIDDEN', 'Admin access is required', 403)

    // no_data_found - the RPC looked the row up and it was gone
    case 'P0002':
      return fail('NOT_FOUND', raw || 'Not found', 404)

    // invalid_parameter_value - the RPC rejected the caller's input
    case '22023':
      return fail('INVALID_REQUEST', raw || fallbackMessage, 400)

    // foreign_key_violation - used by the delete guards for "still referenced"
    case '23503':
      return fail('CONFLICT', raw || 'This row is still referenced', 409)

    // unique_violation - almost always a duplicate slug or code
    case '23505':
      return fail('INVALID_REQUEST', 'A row with this slug or code already exists', 400)

    default:
      break
  }

  // P0001 is a bare `raise exception '...'`, which the older RPCs use for their
  // admin check. Match on the text rather than promoting every P0001 to a 403.
  if (error?.code === 'P0001' && /not allowed/i.test(raw)) {
    return fail('FORBIDDEN', 'Admin access is required', 403)
  }

  return failFromDbError(scope, fallbackCode, fallbackMessage, error ?? null)
}
