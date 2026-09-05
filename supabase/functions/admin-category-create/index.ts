import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalInteger, asOptionalText } from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

// label is required; slug is derived from it when omitted. Everything else
// is optional.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
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

    // Called with the caller's JWT, not the service-role key: the RPC runs
    // is_admin() itself and the audit trigger records the real actor.
    const { data, error } = await ctx.supabase
      .rpc('admin_upsert_category', {
        p_id: null,
        p_label: label,
        p_slug: slug,
        p_icon_key: icon_key,
        p_accent: accent,
        p_accent_dark: accent_dark,
        p_sort_order: sort_order,
      })

    if (error) {
      return failFromRpcError(
        'admin-category-create',
        'ADMIN_CATEGORY_CREATE_FAILED',
        'Unable to create category',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-category-create', error)
  }
})
