import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalUuidArray, requireUuidField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const categoryId = requireUuidField(payload, ['categoryId', 'category_id', 'id'], 'categoryId')

    if (!Object.hasOwn(payload, 'bookIds') && !Object.hasOwn(payload, 'book_ids')) {
      return fail('INVALID_REQUEST', 'bookIds is required (use [] to clear)', 400)
    }

    const bookIds = asOptionalUuidArray('bookIds')(payload.bookIds ?? payload.book_ids) ?? []

    const { error } = await ctx.supabase.rpc('admin_set_category_books', {
      p_category_id: categoryId,
      p_book_ids: bookIds,
    })

    if (error) {
      return failFromDbError(
        'admin-set-category-books',
        'ADMIN_SET_CATEGORY_BOOKS_FAILED',
        'Unable to update category membership',
        error,
      )
    }

    return ok({ categoryId, bookIds, count: bookIds.length })
  } catch (error) {
    return handleError('admin-set-category-books', error)
  }
})
