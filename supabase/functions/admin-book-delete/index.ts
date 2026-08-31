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
import { requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const ids = requireUuidArrayField(payload, ['ids', 'bookIds', 'book_ids'], 'ids')

    const { data, error } = await ctx.supabase.rpc('admin_delete_books', { p_ids: ids })

    if (error) {
      return failFromDbError(
        'admin-book-delete',
        'ADMIN_BOOK_DELETE_FAILED',
        'Unable to delete books',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-book-delete', error)
  }
})
