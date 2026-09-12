import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asInteger, requireUuidField } from '../_shared/payload.ts'

// The reader's bookmark button. One round trip: the database deletes the
// bookmark on (book, page) if it is there and creates it if not, and answers
// with which of the two happened.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')
    const pageNumber = asInteger('page_number', { min: 1 })(
      payload.page_number ?? payload.pageNumber,
    )

    const { data, error } = await ctx.supabase.rpc('toggle_highlight', {
      p_book_id: bookId,
      p_page_number: pageNumber,
    })

    if (error) {
      // 23503 is a foreign key violation: the book id does not exist.
      if (error.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      return failFromDbError(
        'highlights-toggle',
        'HIGHLIGHT_TOGGLE_FAILED',
        'Unable to toggle bookmark',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('highlights-toggle', error)
  }
})
