import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  list,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asOptionalInteger, asOptionalText, asInteger, requireUuidField } from '../_shared/payload.ts'

// The scale is fixed by the database: reading_progress.progress is CHECK
// (progress >= 0 and progress <= 1), and admin_user_directory counts a book as
// finished at >= 0.99.
//
// Guessing the scale per request cannot work. `progress: 1` is genuinely
// ambiguous - it is "finished" on a 0-1 scale and "1% read" on a 0-100 scale -
// and the old `value > 1 ? value / 100 : value` heuristic resolved it as
// "finished", marking a book complete for a reader one page in. So the two
// scales get two field names and anything out of range is a 400.
function resolveProgress(payload: Record<string, unknown>): number | undefined {
  const hasFraction = Object.hasOwn(payload, 'progress')
  const hasPercent =
    Object.hasOwn(payload, 'progress_percent') || Object.hasOwn(payload, 'progressPercent')

  if (hasFraction && hasPercent) {
    throw new BadRequestError('Send either progress (0-1) or progress_percent (0-100), not both')
  }

  if (hasPercent) {
    const raw = payload.progress_percent ?? payload.progressPercent
    const parsed = Number(raw)

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new BadRequestError('progress_percent must be a number between 0 and 100')
    }

    return Number((parsed / 100).toFixed(4))
  }

  if (hasFraction) {
    const parsed = Number(payload.progress)

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new BadRequestError(
        'progress must be a number between 0 and 1. Use progress_percent for a 0-100 value.',
      )
    }

    return Number(parsed.toFixed(4))
  }

  return undefined
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET', 'POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    if (req.method === 'GET') {
      const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

      const { data, count, error } = await ctx.supabase
        .from('reading_progress')
        .select('*', { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('last_read_at', { ascending: false })
        .order('book_id', { ascending: true })
        .range(from, to)

      if (error) {
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

    const currentPage = Object.hasOwn(payload, 'current_page') || Object.hasOwn(payload, 'currentPage')
      ? asInteger('current_page', { min: 1 })(payload.current_page ?? payload.currentPage)
      : 1

    const totalPages = asOptionalInteger('total_pages', { min: 1 })(
      payload.total_pages ?? payload.totalPages ?? null,
    )

    if (totalPages !== null && currentPage > totalPages) {
      throw new BadRequestError('current_page cannot be greater than total_pages')
    }

    const progress = resolveProgress(payload)

    const { data, error } = await ctx.supabase
      .from('reading_progress')
      .upsert(
        {
          user_id: ctx.user.id,
          book_id: bookId,
          current_page: currentPage,
          total_pages: totalPages,
          progress: progress ?? 0,
          chapter_label: asOptionalText('chapter_label')(
            payload.chapter_label ?? payload.chapterLabel ?? null,
          ),
          last_read_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,book_id' },
      )
      .select()
      .maybeSingle()

    if (error) {
      // 23503 is a foreign key violation: the book id does not exist.
      if (error.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      return failFromDbError(
        'reading-progress',
        'READING_PROGRESS_WRITE_FAILED',
        'Unable to save reading progress',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('reading-progress', error)
  }
})
