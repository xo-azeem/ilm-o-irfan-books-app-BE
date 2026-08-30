import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalInteger, requireUuidField } from '../_shared/payload.ts'

const ALLOWED_STATUS = ['pending', 'completed', 'failed']

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')

    const status = payload.status ?? 'completed'

    // The column has a CHECK constraint; reject here so the caller gets a 400
    // with a usable message instead of a constraint violation as a 500.
    if (typeof status !== 'string' || !ALLOWED_STATUS.includes(status)) {
      throw new BadRequestError(`status must be one of: ${ALLOWED_STATUS.join(', ')}`)
    }

    const fileSize = asOptionalInteger('file_size_bytes', { min: 0 })(
      payload.file_size_bytes ?? payload.fileSizeBytes ?? null,
    )

    const { data, error } = await ctx.supabase
      .from('downloads')
      .upsert(
        {
          user_id: ctx.user.id,
          book_id: bookId,
          status,
          file_size_bytes: fileSize,
          downloaded_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,book_id' },
      )
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      return failFromDbError(
        'downloads-create',
        'DOWNLOAD_WRITE_FAILED',
        'Unable to save download',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('downloads-create', error)
  }
})
