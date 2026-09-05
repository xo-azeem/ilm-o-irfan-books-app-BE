import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)
    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    let query = ctx.supabase
      .from('highlights')
      .select('*', { count: 'exact' })
      .eq('user_id', ctx.user.id)

    // The reader screen only wants the highlights for the open book.
    const bookIdParam = url.searchParams.get('book_id') ?? url.searchParams.get('bookId')
    if (bookIdParam) {
      query = query.eq('book_id', asUuid('book_id')(bookIdParam))
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError(
        'highlights-list',
        'HIGHLIGHTS_READ_FAILED',
        'Unable to load highlights',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return handleError('highlights-list', error)
  }
})
