import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalText, pickProvided, type FieldSpec } from '../_shared/payload.ts'

// Only these columns are writable by the owner. role, email, id and the
// timestamps are deliberately absent.
const EDITABLE_FIELDS: FieldSpec[] = [
  { column: 'full_name', aliases: ['full_name', 'fullName'], coerce: asOptionalText('full_name') },
  { column: 'phone', aliases: ['phone'], coerce: asOptionalText('phone') },
  {
    column: 'avatar_path',
    aliases: ['avatar_path', 'avatarPath'],
    coerce: asOptionalText('avatar_path'),
  },
  { column: 'city', aliases: ['city'], coerce: asOptionalText('city') },
  { column: 'state', aliases: ['state'], coerce: asOptionalText('state') },
  { column: 'country', aliases: ['country'], coerce: asOptionalText('country') },
  {
    column: 'address_line1',
    aliases: ['address_line1', 'addressLine1'],
    coerce: asOptionalText('address_line1'),
  },
  {
    column: 'address_line2',
    aliases: ['address_line2', 'addressLine2'],
    coerce: asOptionalText('address_line2'),
  },
  {
    column: 'postal_code',
    aliases: ['postal_code', 'postalCode'],
    coerce: asOptionalText('postal_code'),
  },
]

const PROFILE_COLUMNS =
  'id, full_name, email, phone, avatar_path, date_of_birth, address_line1, address_line2, city, state, postal_code, country, role, created_at, updated_at'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    // Only columns the caller actually sent are written. Sending
    // { full_name } must not null out the address the user saved last week.
    const update = pickProvided(payload, EDITABLE_FIELDS)

    if (Object.keys(update).length === 0) {
      return fail('INVALID_REQUEST', 'No editable profile fields were provided', 400)
    }

    // updated_at is deliberately NOT set here. `authenticated` holds
    // column-level UPDATE grants on profiles that cover the editable columns
    // but not updated_at, so writing it fails the whole statement with 42501
    // "permission denied for table profiles" - which is why this endpoint
    // returned 500 on every call. The profiles_set_updated_at trigger
    // maintains the column server-side.
    const { data, error } = await ctx.supabase
      .from('profiles')
      .update(update)
      .eq('id', ctx.user.id)
      .select(PROFILE_COLUMNS)
      .maybeSingle()

    if (error) {
      return failFromDbError(
        'profile-update',
        'PROFILE_UPDATE_FAILED',
        'Unable to update profile',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Profile not found', 404)
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('profile-update', error)
  }
})
