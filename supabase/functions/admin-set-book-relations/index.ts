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
    const bookId = requireUuidField(payload, ['bookId', 'book_id', 'id'], 'bookId')

    const hasCategories =
      Object.hasOwn(payload, 'categoryIds') || Object.hasOwn(payload, 'category_ids')
    const hasCollections =
      Object.hasOwn(payload, 'collectionIds') || Object.hasOwn(payload, 'collection_ids')

    if (!hasCategories && !hasCollections) {
      return fail('INVALID_REQUEST', 'Provide categoryIds and/or collectionIds', 400)
    }

    // RPC treats null as "clear this side". If the caller only sent one side,
    // preserve the other by loading current membership first.
    let categoryIds = hasCategories
      ? asOptionalUuidArray('categoryIds')(payload.categoryIds ?? payload.category_ids)
      : null
    let collectionIds = hasCollections
      ? asOptionalUuidArray('collectionIds')(payload.collectionIds ?? payload.collection_ids)
      : null

    if (!hasCategories || !hasCollections) {
      const [catsRes, colsRes] = await Promise.all([
        ctx.supabase.from('book_categories').select('category_id').eq('book_id', bookId),
        ctx.supabase.from('collection_books').select('collection_id').eq('book_id', bookId),
      ])

      if (catsRes.error) {
        return failFromDbError(
          'admin-set-book-relations',
          'ADMIN_SET_RELATIONS_FAILED',
          'Unable to load current categories',
          catsRes.error,
        )
      }
      if (colsRes.error) {
        return failFromDbError(
          'admin-set-book-relations',
          'ADMIN_SET_RELATIONS_FAILED',
          'Unable to load current collections',
          colsRes.error,
        )
      }

      if (!hasCategories) {
        categoryIds = (catsRes.data ?? []).map((row) => row.category_id as string)
      }
      if (!hasCollections) {
        collectionIds = (colsRes.data ?? []).map((row) => row.collection_id as string)
      }
    }

    const { error } = await ctx.supabase.rpc('admin_set_book_relations', {
      p_book_id: bookId,
      p_category_ids: categoryIds ?? [],
      p_collection_ids: collectionIds ?? [],
    })

    if (error) {
      return failFromDbError(
        'admin-set-book-relations',
        'ADMIN_SET_RELATIONS_FAILED',
        'Unable to update book relations',
        error,
      )
    }

    return ok({ bookId, categoryIds: categoryIds ?? [], collectionIds: collectionIds ?? [] })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-set-book-relations', error)
  }
})
