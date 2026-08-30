import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  asBoolean,
  asOptionalText,
  asOptionalUuid,
  pickProvided,
  type FieldSpec,
} from '../_shared/payload.ts'

// maintenance_mode, signup_enabled and allow_pdf_without_entitlement are NOT
// NULL columns. Writing `payload.x ?? null` for each of them meant any PATCH
// that did not send all three failed with a not-null violation, so only a
// full-form save ever worked.
const EDITABLE_FIELDS: FieldSpec[] = [
  {
    column: 'maintenance_mode',
    aliases: ['maintenance_mode', 'maintenanceMode'],
    coerce: asBoolean('maintenance_mode'),
  },
  {
    column: 'maintenance_message',
    aliases: ['maintenance_message', 'maintenanceMessage'],
    coerce: asOptionalText('maintenance_message'),
  },
  {
    column: 'signup_enabled',
    aliases: ['signup_enabled', 'signupEnabled'],
    coerce: asBoolean('signup_enabled'),
  },
  {
    column: 'allow_pdf_without_entitlement',
    aliases: ['allow_pdf_without_entitlement', 'allowPdfWithoutEntitlement'],
    coerce: asBoolean('allow_pdf_without_entitlement'),
  },
  {
    column: 'featured_collection_id',
    aliases: ['featured_collection_id', 'featuredCollectionId'],
    coerce: asOptionalUuid('featured_collection_id'),
  },
  {
    column: 'support_email',
    aliases: ['support_email', 'supportEmail'],
    coerce: asOptionalText('support_email'),
  },
  {
    column: 'min_supported_version',
    aliases: ['min_supported_version', 'minSupportedVersion'],
    coerce: asOptionalText('min_supported_version'),
  },
]

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    if (req.method === 'GET') {
      const { data, error } = await ctx.admin
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()

      if (error) {
        return failFromDbError(
          'admin-settings',
          'ADMIN_SETTINGS_READ_FAILED',
          'Unable to load settings',
          error,
        )
      }

      return ok(data ?? null)
    }

    const payload = await readJsonBody(req)
    const update = pickProvided(payload, EDITABLE_FIELDS)

    if (Object.keys(update).length === 0) {
      return fail('INVALID_REQUEST', 'No editable settings fields were provided', 400)
    }

    const { data, error } = await ctx.admin
      .from('app_settings')
      .update(update)
      .eq('id', 1)
      .select()
      .maybeSingle()

    if (error) {
      // 23503: featured_collection_id pointed at a collection that is gone.
      if (error.code === '23503') {
        return fail('INVALID_REQUEST', 'featured_collection_id does not match a collection', 400)
      }

      return failFromDbError(
        'admin-settings',
        'ADMIN_SETTINGS_UPDATE_FAILED',
        'Unable to update settings',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Settings row not found', 404)
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-settings', error)
  }
})
