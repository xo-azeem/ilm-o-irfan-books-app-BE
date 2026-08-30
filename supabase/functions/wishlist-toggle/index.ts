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
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')

    // Delete first and look at what came back. That makes the toggle a single
    // atomic statement: whether the row existed is decided by the database,
    // not by a separate SELECT that a second tap can race.
    const { data: removed, error: deleteError } = await ctx.supabase
      .from('wishlist')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('book_id', bookId)
      .select('book_id')

    if (deleteError) {
      return failFromDbError(
        'wishlist-toggle',
        'WISHLIST_DELETE_FAILED',
        'Unable to remove book from wishlist',
        deleteError,
      )
    }

    if (removed && removed.length > 0) {
      return ok({ wishlisted: false, removed: true, added: false, book_id: bookId })
    }

    // A plain INSERT, not an upsert: `authenticated` holds INSERT, SELECT and
    // DELETE on wishlist but deliberately no UPDATE (there is nothing in the
    // row to update), and PostgREST compiles .upsert() to ON CONFLICT DO
    // UPDATE, which would fail with 42501. A duplicate key here just means a
    // concurrent tap already added it, which is the outcome we wanted.
    const { error: insertError } = await ctx.supabase
      .from('wishlist')
      .insert({ user_id: ctx.user.id, book_id: bookId })

    if (insertError && insertError.code !== '23505') {
      if (insertError.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      return failFromDbError(
        'wishlist-toggle',
        'WISHLIST_INSERT_FAILED',
        'Unable to add book to wishlist',
        insertError,
      )
    }

    return ok({ wishlisted: true, added: true, removed: false, book_id: bookId })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('wishlist-toggle', error)
  }
})
