import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  list,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'
import {
  asInteger,
  asOptionalInteger,
  asOptionalText,
  asUuid,
  requireUuidField,
} from '../_shared/payload.ts'
import {
  clampCurrentPage,
  hasAny,
  resolveClientUpdatedAt,
  resolveProgress,
} from '../_shared/progress.ts'
import { resolveWriteTimeZone } from '../_shared/timezone.ts'

// The compact row the app caches per book. No book embed on purpose: the
// launch-time hydrate pulls every row the user has, and the catalogue is
// already cached on the device under its own key.
//
// finished_at is server-owned: set once when progress first reaches 0.99 and
// never cleared, so "finished this month" survives a reader flipping back.
const ROW_COLUMNS =
  'id, user_id, book_id, current_page, total_pages, progress, chapter_label, last_read_at, finished_at, created_at, updated_at'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET', 'POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const bookIdParam = url.searchParams.get('book_id') ?? url.searchParams.get('bookId')

      // Opening a book: one keyed lookup. A book the user has never opened is
      // { data: null }, not a 404 - "no position yet" is a normal answer here.
      if (bookIdParam) {
        const bookId = asUuid('book_id')(bookIdParam)

        const { data, error } = await ctx.supabase
          .from('reading_progress')
          .select(ROW_COLUMNS)
          .eq('user_id', ctx.user.id)
          .eq('book_id', bookId)
          .maybeSingle()

        if (error) {
          return failFromDbError(
            'reading-progress',
            'READING_PROGRESS_READ_FAILED',
            'Unable to read reading progress',
            error,
          )
        }

        return ok(data ?? null)
      }

      // App launch: every position the user has, newest first, so each book
      // can open at its page without a round trip. pageSize goes to 200 so a
      // normal library is one call.
      const { page, pageSize, from, to } = rangeFromRequest(req, {
        defaultPageSize: 100,
        maxPageSize: 200,
      })

      const { data, count, error } = await ctx.supabase
        .from('reading_progress')
        .select(ROW_COLUMNS, { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('last_read_at', { ascending: false })
        .order('book_id', { ascending: true })
        .range(from, to)

      if (error) {
        // The last call of a "load more" loop asks for a page that starts past
        // the end. That is an empty page, not a failure.
        if (isRangeNotSatisfiable(error)) {
          return list(paginate([], count ?? null, page, pageSize))
        }

        return failFromDbError(
          'reading-progress',
          'READING_PROGRESS_READ_FAILED',
          'Unable to read reading progress',
          error,
        )
      }

      return list(paginate(data ?? [], count ?? null, page, pageSize))
    }

    const payload = await readJsonBody(req)
    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')

    // A partial write must stay partial. The reader app syncs progress from a
    // background task that knows the page but not the chapter, so anything the
    // caller did not send is passed as null and left alone by the RPC rather
    // than defaulted back to page 1 / no chapter.
    let currentPage = hasAny(payload, ['current_page', 'currentPage'])
      ? asInteger('current_page', { min: 1 })(payload.current_page ?? payload.currentPage)
      : null

    const totalPages = hasAny(payload, ['total_pages', 'totalPages'])
      ? asOptionalInteger('total_pages', { min: 1 })(payload.total_pages ?? payload.totalPages)
      : null

    if (currentPage !== null) {
      currentPage = clampCurrentPage(currentPage, totalPages)
    }

    // '' is the documented way to clear the chapter; null means "unchanged".
    const chapterLabel = hasAny(payload, ['chapter_label', 'chapterLabel'])
      ? asOptionalText('chapter_label')(payload.chapter_label ?? payload.chapterLabel) ?? ''
      : null

    const progress = resolveProgress(payload)
    const clientUpdatedAt = resolveClientUpdatedAt(payload)

    // Which calendar day (and whether it was a night) this read lands on for
    // the streak: the client_updated_at offset, else tz, else UTC.
    const tz = resolveWriteTimeZone(payload)

    const { data, error } = await ctx.supabase
      .rpc('upsert_reading_progress', {
        p_book_id: bookId,
        p_current_page: currentPage,
        p_total_pages: totalPages,
        p_progress: progress ?? null,
        p_chapter_label: chapterLabel,
        p_client_updated_at: clientUpdatedAt,
        p_tz: tz,
      })

    if (error) {
      // 23503 is a foreign key violation: the book id does not exist.
      if (error.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      // 22023 is raised by the RPC when the merged row would put current_page
      // more than one past total_pages - the caller's input, so a 400.
      if (error.code === '22023') {
        return fail('INVALID_REQUEST', 'current_page cannot be greater than total_pages', 400)
      }

      return failFromDbError(
        'reading-progress',
        'READING_PROGRESS_WRITE_FAILED',
        'Unable to save reading progress',
        error,
      )
    }

    // The RPC answers with the row that is stored after the call plus
    // `applied`. applied:false means a newer position was already there and
    // this write was skipped; the row is what the client should cache.
    return ok(data)
  } catch (error) {
    return handleError('reading-progress', error)
  }
})
