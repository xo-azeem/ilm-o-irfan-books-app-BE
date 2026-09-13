// Edge Function: vault-check
// JWT required.
//
// A device that keeps books offline asks, for every book it holds, whether
// the book still exists and when its current PDF was attached. It compares
// the answer with the stamp it recorded when it downloaded the file:
//
//   - a book missing from the answer was deleted by the admin;
//   - a newer pdf_updated_at means the admin replaced the file;
//
// and in either case the device drops its copy so the old file can never be
// opened again. The answer is the vault_check() function's, verbatim: the
// function is SECURITY DEFINER so an unpublished book still answers (taking a
// title off sale does not take a reader's download away), and it only echoes
// ids the caller already holds.

import { requireMethod, requireUser } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const bookIds = requireUuidArrayField(payload, ['bookIds', 'book_ids', 'ids'], 'bookIds')

    const { data, error } = await ctx.supabase.rpc('vault_check', { p_book_ids: bookIds })

    if (error) {
      return failFromDbError('vault-check', 'VAULT_CHECK_FAILED', 'Unable to check books', error)
    }

    const rows = (data ?? []) as Array<{
      book_id: string
      pdf_updated_at: string
      has_pdf: boolean
      is_published: boolean
    }>

    return ok({
      books: rows.map((row) => ({
        bookId: row.book_id,
        pdfUpdatedAt: row.pdf_updated_at,
        hasPdf: row.has_pdf,
        isPublished: row.is_published,
      })),
    })
  } catch (error) {
    return handleError('vault-check', error)
  }
})
