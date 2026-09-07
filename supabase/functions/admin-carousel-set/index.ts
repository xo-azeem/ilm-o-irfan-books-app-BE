import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { fail, handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import { asOptionalUuidArray } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    if (!Object.hasOwn(payload, 'bookIds') && !Object.hasOwn(payload, 'book_ids')) {
      return fail('INVALID_REQUEST', 'bookIds is required (use [] to clear the carousel)', 400)
    }

    const bookIds = asOptionalUuidArray('bookIds')(payload.bookIds ?? payload.book_ids) ?? []

    // Whole-carousel save: these books, in this order, and nothing else. One
    // statement, so the app never observes a half-applied carousel — and slides
    // that survive the save keep the headline and artwork already written for
    // them, because reordering the rail is not a reason to lose the copy.
    const { data, error } = await ctx.supabase.rpc('admin_carousel_set', {
      p_book_ids: bookIds,
    })

    if (error) {
      return failFromRpcError(
        'admin-carousel-set',
        'ADMIN_CAROUSEL_SET_FAILED',
        'Unable to save the carousel',
        error,
      )
    }

    return ok({ bookIds, count: data ?? bookIds.length })
  } catch (error) {
    return handleError('admin-carousel-set', error)
  }
})
