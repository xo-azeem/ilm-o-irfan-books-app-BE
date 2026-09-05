import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { fail, failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'
import { asUuid } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)
    const raw = url.searchParams.get('id') ?? url.searchParams.get('userId')
    if (!raw) {
      return fail('INVALID_REQUEST', 'id query parameter is required', 400)
    }

    const userId = asUuid('id')(raw)

    const { data, error } = await ctx.supabase.rpc('admin_user_detail', {
      p_user_id: userId,
    })

    if (error) {
      return failFromDbError(
        'admin-user-detail',
        'ADMIN_USER_DETAIL_FAILED',
        'Unable to load user detail',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-user-detail', error)
  }
})
