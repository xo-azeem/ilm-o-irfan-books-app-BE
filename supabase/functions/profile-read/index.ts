import { requireMethod, requireUser, serviceClient } from '../_shared/auth.ts'
import { fail, failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'
import { resolveTimeZone } from '../_shared/timezone.ts'

const PROFILE_COLUMNS =
  'id, full_name, email, phone, avatar_path, date_of_birth, address_line1, address_line2, city, state, postal_code, country, locale, role, created_at, updated_at'

// The avatars bucket is private, so avatar_path on its own renders nothing.
// Signing it here saves the app a second round trip on every profile load.
const AVATAR_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    // The reading record is calendar-shaped ("today", "this month"), and the
    // calendar is the reader's. ?tz=Asia/Karachi sets it; the default is UTC
    // and the response says which one was used.
    const tz = resolveTimeZone(new URL(req.url).searchParams.get('tz'))

    const [profileRes, streakRes, recordRes] = await Promise.all([
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
      ctx.supabase.rpc('reading_record', { p_tz: tz }),
    ])

    if (profileRes.error) {
      return failFromDbError(
        'profile-read',
        'PROFILE_READ_FAILED',
        'Unable to load profile',
        profileRes.error,
      )
    }

    if (!profileRes.data) {
      return fail('NOT_FOUND', 'Profile not found', 404)
    }

    if (streakRes.error) {
      return failFromDbError(
        'profile-read',
        'STREAK_READ_FAILED',
        'Unable to load reading streak',
        streakRes.error,
      )
    }

    if (recordRes.error) {
      return failFromDbError(
        'profile-read',
        'READING_RECORD_READ_FAILED',
        'Unable to load reading record',
        recordRes.error,
      )
    }

    const record = (recordRes.data ?? {}) as {
      readingGoal?: Record<string, unknown>
      streak?: { recent_days?: unknown[] }
      achievements?: unknown[]
    }

    // A missing or unsignable avatar is not a failed profile read - the screen
    // falls back to initials - so this never turns into an error response.
    let avatarUrl: string | null = null
    const avatarPath = profileRes.data.avatar_path as string | null

    if (avatarPath) {
      const { data: signed, error: signError } = await serviceClient()
        .storage.from('avatars')
        .createSignedUrl(avatarPath, AVATAR_URL_TTL_SECONDS)

      if (signError) {
        console.error('[profile-read] avatar sign failed', signError.message)
      }

      avatarUrl = signed?.signedUrl ?? null
    }

    return ok({
      ...profileRes.data,
      avatarUrl,
      avatarUrlExpiresIn: avatarUrl ? AVATAR_URL_TTL_SECONDS : null,
      // The four streak fields keep coming from the table read they always
      // came from; the RPC only adds the seven-day history beside them.
      streak: {
        ...(streakRes.data ?? {
          current_streak: 0,
          longest_streak: 0,
          last_read_date: null,
          updated_at: null,
        }),
        recent_days: record.streak?.recent_days ?? [],
      },
      readingGoal: record.readingGoal ?? null,
      achievements: record.achievements ?? [],
    })
  } catch (error) {
    return handleError('profile-read', error)
  }
})
