import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import { requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    // Slide ids in the order they should appear. Slides not named keep their
    // relative order behind the ones that are, so a CMS that only sends the
    // page it is showing cannot renumber the rest of the carousel to 0.
    const ids = requireUuidArrayField(
      payload,
      ['ids', 'slideIds', 'slide_ids'],
      'ids',
    )

    const { data, error } = await ctx.supabase.rpc('admin_carousel_reorder', { p_ids: ids })

    if (error) {
      return failFromRpcError(
        'admin-carousel-reorder',
        'ADMIN_CAROUSEL_REORDER_FAILED',
        'Unable to reorder the carousel',
        error,
      )
    }

    return ok({ requested: ids.length, reordered: data ?? 0 })
  } catch (error) {
    return handleError('admin-carousel-reorder', error)
  }
})
