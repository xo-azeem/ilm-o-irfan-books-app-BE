import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import { asUuid, requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    // Single or bulk, slide id or book id: the RPC matches on either column, so
    // the CMS list screen and the book editor can both call this with whatever
    // id they happen to be holding.
    const singular = payload.id ?? payload.slideId ?? payload.slide_id ??
      payload.bookId ?? payload.book_id

    const ids = singular !== undefined && singular !== null
      ? [asUuid('id')(singular)]
      : requireUuidArrayField(
        payload,
        ['ids', 'slideIds', 'slide_ids', 'bookIds', 'book_ids'],
        'ids',
      )

    const { data, error } = await ctx.supabase.rpc('admin_carousel_delete', { p_ids: ids })

    if (error) {
      return failFromRpcError(
        'admin-carousel-delete',
        'ADMIN_CAROUSEL_DELETE_FAILED',
        'Unable to remove the carousel slide',
        error,
      )
    }

    // `deleted` can legitimately be less than ids.length: removing a book that
    // was never on the carousel is a no-op, not an error, so the CMS can send
    // the same request twice without the second one failing.
    return ok({ requested: ids.length, deleted: data ?? 0 })
  } catch (error) {
    return handleError('admin-carousel-delete', error)
  }
})
