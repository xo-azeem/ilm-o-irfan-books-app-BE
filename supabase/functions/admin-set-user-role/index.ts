import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalText, requireUuidField } from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const userId = requireUuidField(payload, ['userId', 'user_id', 'id', 'targetId'], 'userId')
    const role = asOptionalText('role')(payload.role)

    if (role !== 'user' && role !== 'admin') {
      return fail('INVALID_REQUEST', 'role must be user or admin', 400)
    }

    const { error } = await ctx.supabase.rpc('admin_set_user_role', {
      target_id: userId,
      new_role: role,
    })

    if (error) {
      // 23514 is the last-admin guard. It is the caller's request that is
      // refused, not the server failing, and the CMS needs to show why.
      if (error.code === '23514') {
        return fail(
          'LAST_ADMIN',
          'This is the last admin. Promote someone else before demoting this account.',
          409,
        )
      }

      return failFromRpcError(
        'admin-set-user-role',
        'ADMIN_SET_ROLE_FAILED',
        'Unable to update user role',
        error,
      )
    }

    return ok({ userId, role })
  } catch (error) {
    return handleError('admin-set-user-role', error)
  }
})
