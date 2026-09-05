import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCoverUrls } from '../_shared/covers.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  list,
} from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const { page, pageSize, from, to } = rangeFromRequest(req)
    const url = new URL(req.url)
    const categoryParam = (url.searchParams.get('category') ?? '').trim()
    const supabase = anonClient()

    let bookIds: string[] | null = null

    if (categoryParam) {
      // Accept category UUID or slug so the Search chip can send either.
      let categoryId: string

      if (UUID_RE.test(categoryParam)) {
        categoryId = asUuid('category')(categoryParam)
      } else {
        const { data: category, error: categoryError } = await supabase
          .from('categories')
          .select('id')
          .eq('slug', categoryParam)
          .maybeSingle()

        if (categoryError) {
          return failFromDbError(
            'books-list',
            'BOOKS_READ_FAILED',
            'Unable to load books',
            categoryError,
          )
        }

        if (!category) {
          return fail('NOT_FOUND', 'Category not found', 404)
        }

        categoryId = category.id as string
      }

      const { data: membership, error: membershipError } = await supabase
        .from('book_categories')
        .select('book_id')
        .eq('category_id', categoryId)

      if (membershipError) {
        return failFromDbError(
          'books-list',
          'BOOKS_READ_FAILED',
          'Unable to load books',
          membershipError,
        )
      }

      bookIds = (membership ?? []).map((row) => row.book_id as string).filter(Boolean)

      if (bookIds.length === 0) {
        return list(paginate([], 0, page, pageSize))
      }
    }

    // published_at can be null, so id is the tiebreaker that keeps paging
    // stable across requests.
    let query = supabase
      .from('book_list_items')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })

    if (bookIds) {
      query = query.in('id', bookIds)
    }

    const { data, count, error } = await query.range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError('books-list', 'BOOKS_READ_FAILED', 'Unable to load books', error)
    }

    const items = withCoverUrls((data ?? []) as Record<string, unknown>[])
    return list(paginate(items, count ?? null, page, pageSize))
  } catch (error) {
    return handleError('books-list', error)
  }
})
