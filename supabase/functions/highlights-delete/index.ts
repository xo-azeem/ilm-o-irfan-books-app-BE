import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { requireUuidField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const id = requireUuidField(payload, ['id', 'highlightId', 'highlight_id'], 'id')

    const { data, error } = await ctx.supabase
      .from('highlights')
      .delete()
      .eq('id', id)
      .eq('user_id', ctx.user.id)
      .select('id')
      .maybeSingle()

    if (error) {
      return failFromDbError(
        'highlights-delete',
        'HIGHLIGHT_DELETE_FAILED',
        'Unable to delete highlight',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Highlight not found', 404)
    }

    return ok({ id: data.id, deleted: true })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('highlights-delete', error)
  }
})
