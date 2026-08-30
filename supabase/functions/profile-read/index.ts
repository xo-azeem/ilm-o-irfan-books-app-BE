import { requireUser } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'

const PROFILE_COLUMNS =
  'id, full_name, email, phone, avatar_path, date_of_birth, address_line1, address_line2, city, state, postal_code, country, role, created_at, updated_at'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const { data, error } = await ctx.supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', ctx.user.id)
      .maybeSingle()

    if (error) {
      return failFromDbError('profile-read', 'PROFILE_READ_FAILED', 'Unable to load profile', error)
    }

    return ok(data ?? null)
  } catch (error) {
    return failUnexpected('profile-read', error)
  }
})
