import { anonClient } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const { page, pageSize, from, to } = rangeFromRequest(req)

    // published_at can be null, so id is the tiebreaker that keeps paging
    // stable across requests.
    const { data, count, error } = await anonClient()
      .from('book_list_items')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      return failFromDbError('books-list', 'BOOKS_READ_FAILED', 'Unable to load books', error)
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return failUnexpected('books-list', error)
  }
})
