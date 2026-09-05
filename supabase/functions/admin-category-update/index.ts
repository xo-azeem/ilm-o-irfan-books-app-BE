import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalInteger, asOptionalText, requireUuidField } from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

// Partial update: omitted fields keep their stored value.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['PATCH', 'PUT', 'POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const id = requireUuidField(payload, ['id', 'categoryId', 'category_id'], 'id')

    const label = asOptionalText('label')(payload.label ?? null)
    const slug = asOptionalText('slug')(payload.slug ?? null)
    const icon_key = asOptionalText('icon_key')(payload.icon_key ?? payload.iconKey ?? null)
    const accent = asOptionalText('accent')(payload.accent ?? null)
    const accent_dark = asOptionalText('accent_dark')(
      payload.accent_dark ?? payload.accentDark ?? null,
    )
    const sort_order = asOptionalInteger('sort_order')(
      payload.sort_order ?? payload.sortOrder ?? null,
    )

    // An update that names no field would silently succeed as a no-op and look
    // like a saved edit to the CMS. Say so instead.
    const touched = [
      label,
      slug,
      icon_key,
      accent,
      accent_dark,
      sort_order,
    ].some((value) => value !== null)

    if (!touched) {
      return fail('INVALID_REQUEST', 'No editable category fields were provided', 400)
    }

    // Called with the caller's JWT, not the service-role key: the RPC runs
    // is_admin() itself and the audit trigger records the real actor.
    const { data, error } = await ctx.supabase
      .rpc('admin_upsert_category', {
        p_id: id,
        p_label: label,
        p_slug: slug,
        p_icon_key: icon_key,
        p_accent: accent,
        p_accent_dark: accent_dark,
        p_sort_order: sort_order,
      })

    if (error) {
      return failFromRpcError(
        'admin-category-update',
        'ADMIN_CATEGORY_UPDATE_FAILED',
        'Unable to update category',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-category-update', error)
  }
})
