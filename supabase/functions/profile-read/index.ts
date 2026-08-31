import { requireMethod, requireUser } from '../_shared/auth.ts'
import { fail, failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'

const PROFILE_COLUMNS =
  'id, full_name, email, phone, avatar_path, date_of_birth, address_line1, address_line2, city, state, postal_code, country, role, created_at, updated_at'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const [profileRes, streakRes] = await Promise.all([
      ctx.supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', ctx.user.id)
        .maybeSingle(),
      ctx.supabase
        .from('reading_streaks')
        .select('current_streak, longest_streak, last_read_date, updated_at')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),
    ])

    if (profileRes.error) {
      return failFromDbError('profile-read', 'PROFILE_READ_FAILED', 'Unable to load profile', profileRes.error)
    }

    if (!profileRes.data) {
      return fail('NOT_FOUND', 'Profile not found', 404)
    }

    if (streakRes.error) {
      return failFromDbError('profile-read', 'STREAK_READ_FAILED', 'Unable to load reading streak', streakRes.error)
    }

    return ok({
      ...profileRes.data,
      streak: streakRes.data ?? {
        current_streak: 0,
        longest_streak: 0,
        last_read_date: null,
        updated_at: null,
      },
    })
  } catch (error) {
    return failUnexpected('profile-read', error)
  }
})
