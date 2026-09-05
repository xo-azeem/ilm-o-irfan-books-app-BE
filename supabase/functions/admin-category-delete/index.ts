import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { asBoolean, requireUuidField } from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

// force=true is the deliberate override for the guard the RPC applies; without
// it a delete that would strip content out from under readers is refused with a
// 409 that names what is still attached.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const id = requireUuidField(payload, ['id', 'categoryId', 'category_id'], 'id')
    const force = Object.hasOwn(payload, 'force') ? asBoolean('force')(payload.force) : false

    const { data, error } = await ctx.supabase.rpc('admin_delete_category', {
      p_id: id,
      p_force: force,
    })

    if (error) {
      return failFromRpcError(
        'admin-category-delete',
        'ADMIN_CATEGORY_DELETE_FAILED',
        'Unable to delete category',
        error,
      )
    }

    return ok({ ...(data as Record<string, unknown>), deleted: true })
  } catch (error) {
    return handleError('admin-category-delete', error)
  }
})
