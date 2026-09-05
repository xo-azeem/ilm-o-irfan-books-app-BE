import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  asBoolean,
  asOptionalInteger,
  asOptionalText,
  requireUuidField,
} from '../_shared/payload.ts'
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
    const id = requireUuidField(payload, ['id', 'collectionId', 'collection_id'], 'id')

    const title = asOptionalText('title')(payload.title ?? null)
    const slug = asOptionalText('slug')(payload.slug ?? null)
    const subtitle = asOptionalText('subtitle')(payload.subtitle ?? null)
    const accent = asOptionalText('accent')(payload.accent ?? null)
    const kind = asOptionalText('kind')(payload.kind ?? null)
    const sort_order = asOptionalInteger('sort_order')(
      payload.sort_order ?? payload.sortOrder ?? null,
    )
    const is_published =
      Object.hasOwn(payload, 'is_published') || Object.hasOwn(payload, 'isPublished')
        ? asBoolean('is_published')(payload.is_published ?? payload.isPublished)
        : null

    // An update that names no field would silently succeed as a no-op and look
    // like a saved edit to the CMS. Say so instead.
    const touched = [
      title,
      slug,
      subtitle,
      accent,
      kind,
      sort_order,
      is_published,
    ].some((value) => value !== null)

    if (!touched) {
      return fail('INVALID_REQUEST', 'No editable collection fields were provided', 400)
    }

    // Called with the caller's JWT, not the service-role key: the RPC runs
    // is_admin() itself and the audit trigger records the real actor.
    const { data, error } = await ctx.supabase
      .rpc('admin_upsert_collection', {
        p_id: id,
        p_title: title,
        p_slug: slug,
        p_subtitle: subtitle,
        p_accent: accent,
        p_kind: kind,
        p_sort_order: sort_order,
        p_is_published: is_published,
      })

    if (error) {
      return failFromRpcError(
        'admin-collection-update',
        'ADMIN_COLLECTION_UPDATE_FAILED',
        'Unable to update collection',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-collection-update', error)
  }
})
