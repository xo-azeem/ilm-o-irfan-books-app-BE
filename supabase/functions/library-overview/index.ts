import { requireUser } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'
import { normalizePageSize } from '../_shared/pagination.ts'

const BOOK_CARD =
  'book:books(id, slug, title, cover_path, cover_color, cover_color_dark, genre, is_premium, read_time_minutes)'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)

    // This screen is a summary of three shelves, so each shelf is capped and
    // reports its own total. Callers that need the full list page through
    // wishlist-list / downloads-list / reading-progress instead.
    const limit = normalizePageSize(url.searchParams.get('limit') ?? undefined, 20, 50)

    const [wishlistRes, progressRes, downloadsRes] = await Promise.all([
      ctx.supabase
        .from('wishlist')
        .select(`book_id, created_at, ${BOOK_CARD}`, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('reading_progress')
        .select(`book_id, current_page, total_pages, progress, chapter_label, last_read_at, ${BOOK_CARD}`, {
          count: 'exact',
        })
        .eq('user_id', ctx.user.id)
        .order('last_read_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('downloads')
        .select(`book_id, status, file_size_bytes, downloaded_at, ${BOOK_CARD}`, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('downloaded_at', { ascending: false })
        .limit(limit),
    ])

    const failed = [
      ['wishlist', wishlistRes.error] as const,
      ['reading_progress', progressRes.error] as const,
      ['downloads', downloadsRes.error] as const,
    ].find(([, error]) => error)

    if (failed) {
      return failFromDbError(
        'library-overview',
        'LIBRARY_READ_FAILED',
        'Unable to load library',
        failed[1],
      )
    }

    return ok({
      limit,
      wishlist: {
        items: wishlistRes.data ?? [],
        totalCount: wishlistRes.count ?? 0,
        hasMore: (wishlistRes.count ?? 0) > (wishlistRes.data?.length ?? 0),
      },
      readingProgress: {
        items: progressRes.data ?? [],
        totalCount: progressRes.count ?? 0,
        hasMore: (progressRes.count ?? 0) > (progressRes.data?.length ?? 0),
      },
      downloads: {
        items: downloadsRes.data ?? [],
        totalCount: downloadsRes.count ?? 0,
        hasMore: (downloadsRes.count ?? 0) > (downloadsRes.data?.length ?? 0),
      },
    })
  } catch (error) {
    return failUnexpected('library-overview', error)
  }
})
