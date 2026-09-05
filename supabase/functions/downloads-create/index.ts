import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalInteger, requireUuidField } from '../_shared/payload.ts'

// Downloads are TELEMETRY, not accounting.
//
// status and file_size_bytes are attested by the client and nothing verifies
// them, so a row here means "a device said it saved this file" and nothing
// stronger. It drives the Library "Downloaded" shelf and the admin download
// counter; it must never gate access, billing, or a refund decision. The only
// authority on whether a reader may hold the bytes is get-signed-pdf, and it
// re-checks the entitlement on every request.
//
// If downloads ever need to be trusted, the fix is a short-lived token minted
// by get-signed-pdf and required here - not tighter validation of a field the
// client still supplies.
const ALLOWED_STATUS = ['pending', 'completed', 'failed']

// The storage bucket caps uploads at 100 MiB. A reported size an order of
// magnitude past that is a bug or a probe, not a book.
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024

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

    const fileSize = asOptionalInteger('file_size_bytes', {
      min: 0,
      max: MAX_FILE_SIZE_BYTES,
    })(payload.file_size_bytes ?? payload.fileSizeBytes ?? null)

    // The foreign key only proves the book row exists, including drafts and
    // titles the caller can't see. Reading it through the user's own client
    // means RLS answers "is this book published?" for us, so a download record
    // cannot be planted against an unpublished id to probe the catalog.
    const { data: book, error: bookError } = await ctx.supabase
      .from('books')
      .select('id')
      .eq('id', bookId)
      .maybeSingle()

    if (bookError) {
      return failFromDbError(
        'downloads-create',
        'BOOK_READ_FAILED',
        'Unable to load book',
        bookError,
      )
    }

    if (!book) {
      return fail('NOT_FOUND', 'Book not found', 404)
    }

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
    return handleError('downloads-create', error)
  }
})
