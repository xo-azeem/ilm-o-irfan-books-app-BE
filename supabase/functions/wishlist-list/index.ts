import { requireUser } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, list } from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const { page, pageSize, from, to } = rangeFromRequest(req)

    // Card-sized book payload only. books(*) shipped the full row, including
    // description and pdf_path, for every saved title.
    const { data, count, error } = await ctx.supabase
      .from('wishlist')
      .select(
        'book_id, created_at, book:books(id, slug, title, cover_path, cover_color, cover_color_dark, genre, is_premium, read_time_minutes)',
        { count: 'exact' },
      )
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false })
      .order('book_id', { ascending: true })
      .range(from, to)

    if (error) {
      return failFromDbError('wishlist-list', 'WISHLIST_READ_FAILED', 'Unable to load wishlist', error)
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return failUnexpected('wishlist-list', error)
  }
})
