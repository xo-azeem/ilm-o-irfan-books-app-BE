// Edge Function: get-signed-pdf
// JWT required. Admins may preview drafts.
// Access is granted when any of these is true:
//   - JWT / profile role is admin
//   - ALLOW_PDF_WITHOUT_ENTITLEMENT env is on (true/1/yes/on)
//   - app_settings.allow_pdf_without_entitlement is on
//   - the user has an active entitlement

import { requireMethod, requireUser, serviceClient } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { requireUuidField } from '../_shared/payload.ts'

function envFlagOn(name: string): boolean {
  const value = (Deno.env.get(name) ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const body = await readJsonBody(req)
    const bookId = requireUuidField(body, ['bookId', 'book_id'], 'bookId')

    const admin = serviceClient()

    // Role, product flags and the book row are independent reads.
    const [profileRes, settingsRes, bookRes] = await Promise.all([
      admin.from('profiles').select('role').eq('id', ctx.user.id).maybeSingle(),
      admin
        .from('app_settings')
        .select('allow_pdf_without_entitlement')
        .eq('id', 1)
        .maybeSingle(),
      admin
        .from('books')
        .select('id, title, pdf_path, is_published, file_size_bytes')
        .eq('id', bookId)
        .maybeSingle(),
    ])

    if (bookRes.error) {
      return failFromDbError('get-signed-pdf', 'BOOK_READ_FAILED', 'Unable to load book', bookRes.error)
    }

    const isAdmin =
      ctx.user.app_metadata?.app_role === 'admin' || profileRes.data?.role === 'admin'

    // If the settings row could not be read, fall back to the closed position
    // rather than handing out a free PDF.
    if (settingsRes.error) {
      console.error('[get-signed-pdf] settings read failed', settingsRes.error.message)
    }

    const allowWithoutEntitlement =
      envFlagOn('ALLOW_PDF_WITHOUT_ENTITLEMENT') ||
      settingsRes.data?.allow_pdf_without_entitlement === true

    const book = bookRes.data

    if (!book || (!isAdmin && !book.is_published)) {
      return fail('NOT_FOUND', 'Book not found', 404)
    }

    if (!book.pdf_path) {
      return fail('PDF_NOT_AVAILABLE', 'PDF not available for this book', 404)
    }

    if (!isAdmin && !allowWithoutEntitlement) {
      const { data: entitlement, error: entError } = await admin
        .from('entitlements')
        .select('status, expires_at')
        .eq('user_id', ctx.user.id)
        .maybeSingle()

      if (entError) {
        return failFromDbError(
          'get-signed-pdf',
          'ENTITLEMENT_READ_FAILED',
          'Unable to verify subscription',
          entError,
        )
      }

      const active =
        entitlement?.status === 'active' &&
        (entitlement.expires_at == null ||
          new Date(entitlement.expires_at).getTime() > Date.now())

      if (!active) {
        return fail('PREMIUM_REQUIRED', 'Active subscription required', 403)
      }
    }

    const expiresIn = Number(Deno.env.get('SIGNED_PDF_EXPIRES_IN') ?? '300')
    const rawPath = book.pdf_path.replace(/^\/+/, '')
    const stripped = rawPath.replace(/^pdfs\//, '')
    const candidates = [...new Set([stripped, rawPath].filter(Boolean))]

    let signedUrl: string | null = null

    for (const objectPath of candidates) {
      const { data: signed, error: signError } = await admin.storage
        .from('pdfs')
        .createSignedUrl(objectPath, expiresIn)

      if (signed?.signedUrl) {
        signedUrl = signed.signedUrl
        break
      }

      console.error('[get-signed-pdf] sign failed', objectPath, signError?.message)
    }

    if (!signedUrl) {
      return fail('PDF_NOT_IN_STORAGE', 'PDF file not found in storage', 404)
    }

    return ok({
      bookId: book.id,
      title: book.title,
      signedUrl,
      expiresIn,
      fileSizeBytes: book.file_size_bytes ?? null,
    })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('get-signed-pdf', error)
  }
})
