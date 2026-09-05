import { requireMethod, requireUser } from '../_shared/auth.ts'
import { withNestedBookCoverUrls } from '../_shared/covers.ts'
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

    const { data, count, error } = await ctx.supabase
      .from('downloads')
      .select(
        'id, book_id, status, file_size_bytes, downloaded_at, book:books(id, slug, title, cover_path, cover_color, cover_color_dark, genre, is_premium, read_time_minutes, author:authors(name))',
        { count: 'exact' },
      )
      .eq('user_id', ctx.user.id)
      .order('downloaded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError(
        'downloads-list',
        'DOWNLOADS_READ_FAILED',
        'Unable to load downloads',
        error,
      )
    }

    const items = withNestedBookCoverUrls((data ?? []) as Record<string, unknown>[])
    return list(paginate(items, count ?? null, page, pageSize))
  } catch (error) {
    return handleError('downloads-list', error)
  }
})
