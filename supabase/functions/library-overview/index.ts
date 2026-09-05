import { requireMethod, requireUser } from '../_shared/auth.ts'
import { withNestedBookCoverUrls } from '../_shared/covers.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'
import { normalizePageSize } from '../_shared/pagination.ts'

const BOOK_CARD =
  'book:books(id, slug, title, cover_path, cover_color, cover_color_dark, genre, is_premium, read_time_minutes, author:authors(name))'

const FINISHED_THRESHOLD = 0.99

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)

    // Summary shelves — each capped; page full lists via dedicated endpoints.
    const limit = normalizePageSize(url.searchParams.get('limit') ?? undefined, 20, 50)

    const progressSelect =
      `book_id, current_page, total_pages, progress, chapter_label, last_read_at, ${BOOK_CARD}`

    const [
      wishlistRes,
      progressRes,
      finishedRes,
      downloadsRes,
      highlightsRes,
    ] = await Promise.all([
      ctx.supabase
        .from('wishlist')
        .select(`book_id, created_at, ${BOOK_CARD}`, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('reading_progress')
        .select(progressSelect, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .lt('progress', FINISHED_THRESHOLD)
        .order('last_read_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('reading_progress')
        .select(progressSelect, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .gte('progress', FINISHED_THRESHOLD)
        .order('last_read_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('downloads')
        .select(`book_id, status, file_size_bytes, downloaded_at, ${BOOK_CARD}`, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('downloaded_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('highlights')
        .select(
          `id, book_id, page_number, text_excerpt, note, color, created_at, updated_at, ${BOOK_CARD}`,
          { count: 'exact' },
        )
        .eq('user_id', ctx.user.id)
        .order('updated_at', { ascending: false })
        .limit(limit),
    ])

    const failed = [
      ['wishlist', wishlistRes.error] as const,
      ['reading_progress', progressRes.error] as const,
      ['finished', finishedRes.error] as const,
      ['downloads', downloadsRes.error] as const,
      ['highlights', highlightsRes.error] as const,
    ].find(([, error]) => error)

    if (failed) {
      return failFromDbError(
        'library-overview',
        'LIBRARY_READ_FAILED',
        'Unable to load library',
        failed[1],
      )
    }

    const shelf = (res: { data: Record<string, unknown>[] | null; count: number | null }) => {
      const items = withNestedBookCoverUrls(res.data ?? [])
      return {
        items,
        totalCount: res.count ?? 0,
        hasMore: (res.count ?? 0) > items.length,
      }
    }

    return ok({
      limit,
      wishlist: shelf(wishlistRes as { data: Record<string, unknown>[] | null; count: number | null }),
      readingProgress: shelf(
        progressRes as { data: Record<string, unknown>[] | null; count: number | null },
      ),
      finished: shelf(finishedRes as { data: Record<string, unknown>[] | null; count: number | null }),
      downloads: shelf(
        downloadsRes as { data: Record<string, unknown>[] | null; count: number | null },
      ),
      highlights: shelf(
        highlightsRes as { data: Record<string, unknown>[] | null; count: number | null },
      ),
    })
  } catch (error) {
    return handleError('library-overview', error)
  }
})
