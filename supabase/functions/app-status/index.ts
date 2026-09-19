import { anonClient, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok, publicCache } from '../_shared/http.ts'

// The product flags every install checks before it draws anything: whether
// the app is in maintenance, whether sign-ups are open, the oldest build still
// allowed, and where Help Center writes to. Set by an admin on System → App
// settings (admin-settings); read here by the anon role, which has SELECT on
// app_settings by policy.
//
// A short public cache: the app re-reads on every return to the foreground,
// and a minute is the promise the admin tool makes ("readers pick it up
// within a minute"). featured_collection_id is deliberately not here — Home
// already takes it from home-feed with the collections it applies to.
const STATUS_CACHE_SECONDS = 60

const STATUS_COLUMNS =
  'maintenance_mode, maintenance_message, signup_enabled, min_supported_version, support_email, updated_at'

type SettingsRow = {
  maintenance_mode: boolean | null
  maintenance_message: string | null
  signup_enabled: boolean | null
  min_supported_version: string | null
  support_email: string | null
  updated_at: string | null
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const { data, error } = await anonClient()
      .from('app_settings')
      .select(STATUS_COLUMNS)
      .eq('id', 1)
      .maybeSingle<SettingsRow>()

    if (error) {
      return failFromDbError(
        'app-status',
        'APP_STATUS_READ_FAILED',
        'Unable to load app status',
        error,
      )
    }

    // No row is the same as every flag at its default: the app stays open.
    return ok(
      {
        maintenanceMode: data?.maintenance_mode === true,
        maintenanceMessage: text(data?.maintenance_message),
        signupEnabled: data?.signup_enabled !== false,
        minSupportedVersion: text(data?.min_supported_version),
        supportEmail: text(data?.support_email),
        updatedAt: data?.updated_at ?? null,
      },
      200,
      publicCache(STATUS_CACHE_SECONDS),
    )
  } catch (error) {
    return handleError('app-status', error)
  }
})
