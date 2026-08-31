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
import { requireUuidField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const id = requireUuidField(payload, ['id', 'authorId', 'author_id'], 'id')

    const { count, error: countError } = await ctx.admin
      .from('books')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', id)

    if (countError) {
      return failFromDbError(
        'admin-author-delete',
        'ADMIN_AUTHOR_DELETE_FAILED',
        'Unable to check author books',
        countError,
      )
    }

    if ((count ?? 0) > 0) {
      return fail(
        'INVALID_REQUEST',
        'Author still has books; reassign or delete those books first',
        400,
      )
    }

    const { data, error } = await ctx.admin
      .from('authors')
      .delete()
      .eq('id', id)
      .select('id, slug, name')
      .maybeSingle()

    if (error) {
      return failFromDbError(
        'admin-author-delete',
        'ADMIN_AUTHOR_DELETE_FAILED',
        'Unable to delete author',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Author not found', 404)
    }

    return ok({ ...data, deleted: true })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-author-delete', error)
  }
})
