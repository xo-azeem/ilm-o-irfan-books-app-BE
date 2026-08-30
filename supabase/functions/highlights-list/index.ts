import { requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  list,
} from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
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
      return failFromDbError(
        'highlights-list',
        'HIGHLIGHTS_READ_FAILED',
        'Unable to load highlights',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('highlights-list', error)
  }
})
