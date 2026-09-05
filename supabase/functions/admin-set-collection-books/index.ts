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
    const collectionId = requireUuidField(
      payload,
      ['collectionId', 'collection_id', 'id'],
      'collectionId',
    )

    if (!Object.hasOwn(payload, 'bookIds') && !Object.hasOwn(payload, 'book_ids')) {
      return fail('INVALID_REQUEST', 'bookIds is required (use [] to clear)', 400)
    }

    const bookIds = asOptionalUuidArray('bookIds')(payload.bookIds ?? payload.book_ids) ?? []

    const { error } = await ctx.supabase.rpc('admin_set_collection_books', {
      p_collection_id: collectionId,
      p_book_ids: bookIds,
    })

    if (error) {
      return failFromDbError(
        'admin-set-collection-books',
        'ADMIN_SET_COLLECTION_BOOKS_FAILED',
        'Unable to update collection membership',
        error,
      )
    }

    return ok({ collectionId, bookIds, count: bookIds.length })
  } catch (error) {
    return handleError('admin-set-collection-books', error)
  }
})
