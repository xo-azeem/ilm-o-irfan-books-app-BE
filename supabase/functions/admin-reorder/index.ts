import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalText, requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const table = asOptionalText('table')(payload.table ?? payload.target)
    if (table !== 'categories' && table !== 'collections') {
      return fail('INVALID_REQUEST', 'table must be categories or collections', 400)
    }

    const ids = requireUuidArrayField(payload, ['ids'], 'ids')

    const { error } = await ctx.supabase.rpc('admin_reorder', {
      p_table: table,
      p_ids: ids,
    })

    if (error) {
      return failFromDbError(
        'admin-reorder',
        'ADMIN_REORDER_FAILED',
        'Unable to reorder rows',
        error,
      )
    }

    return ok({ table, ids })
  } catch (error) {
    return handleError('admin-reorder', error)
  }
})
