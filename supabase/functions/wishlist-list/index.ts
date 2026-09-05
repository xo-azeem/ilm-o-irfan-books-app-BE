import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const { page, pageSize, from, to } = rangeFromRequest(req)

    // Card-sized book payload only. books(*) shipped the full row, including
    // description and pdf_path, for every saved title.
    const { data, count, error } = await ctx.supabase
      .from('wishlist')
      .select(
        'book_id, created_at, book:books(id, slug, title, cover_path, cover_color, cover_color_dark, genre, is_premium, read_time_minutes, author:authors(name))',
        { count: 'exact' },
      )
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false })
      .order('book_id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError('wishlist-list', 'WISHLIST_READ_FAILED', 'Unable to load wishlist', error)
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return handleError('wishlist-list', error)
  }
})
