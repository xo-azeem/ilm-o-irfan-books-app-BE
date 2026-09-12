import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { asInteger, asOptionalUuid, requireUuidField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    // Either the row id, or the (book, page) key a bookmark is known by in the
    // reader - the app does not have to look the id up first.
    const id = asOptionalUuid('id')(payload.id ?? payload.highlightId ?? payload.highlight_id)

    let query = ctx.supabase
      .from('highlights')
      .delete()
      .eq('user_id', ctx.user.id)

    if (id) {
      query = query.eq('id', id)
    } else {
      const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')
      const pageNumber = asInteger('page_number', { min: 1 })(
        payload.page_number ?? payload.pageNumber,
      )
      query = query.eq('book_id', bookId).eq('page_number', pageNumber)
    }

    const { data, error } = await query.select('id').maybeSingle()

    if (error) {
      return failFromDbError(
        'highlights-delete',
        'HIGHLIGHT_DELETE_FAILED',
        'Unable to delete highlight',
        error,
      )
    }

    // Deleting what is already gone is the outcome the caller wanted, and an
    // offline queue replaying a delete twice must not see an error for it.
    if (!data) {
      return ok({ id: id ?? null, deleted: false })
    }

    return ok({ id: data.id, deleted: true })
  } catch (error) {
    return handleError('highlights-delete', error)
  }
})
