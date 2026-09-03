// Edge Function: get-signed-pdf
// JWT required. Admins may preview drafts.
//
// Access is granted on exactly these conditions, and there is no other:
//   - JWT / profile role is admin
//   - the book is published and free (is_premium = false)
//   - the book is premium and the user has an active entitlement
//
// The former ALLOW_PDF_WITHOUT_ENTITLEMENT env flag and the
// app_settings.allow_pdf_without_entitlement column are both gone from this
// path on purpose. Either one could silently hand every premium PDF to every
// signed-in reader, from a place no code review would look, and the app has no
// way to observe them. If the paywall ever needs opening again, that is a
// product decision that belongs in entitlements, not a hidden switch.

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

    // The role and the book row are independent reads.
    const [profileRes, bookRes] = await Promise.all([
      admin.from('profiles').select('role').eq('id', ctx.user.id).maybeSingle(),
      admin
        .from('books')
        .select('id, title, pdf_path, is_published, is_premium, file_size_bytes')
        .eq('id', bookId)
        .maybeSingle(),
    ])

    if (bookRes.error) {
      return failFromDbError('get-signed-pdf', 'BOOK_READ_FAILED', 'Unable to load book', bookRes.error)
    }

    // A role lookup that fails must not silently promote the caller, but it
    // must not lock out a real admin either, so the JWT claim still stands.
    if (profileRes.error) {
      console.error('[get-signed-pdf] role lookup failed', profileRes.error.message)
    }

    const isAdmin =
      ctx.user.app_metadata?.app_role === 'admin' || profileRes.data?.role === 'admin'

    const book = bookRes.data

    // Admins may preview an unpublished draft; nobody else sees one exists.
    if (!book || (!isAdmin && !book.is_published)) {
      return fail('NOT_FOUND', 'Book not found', 404)
    }

    if (!book.pdf_path) {
      return fail('PDF_NOT_AVAILABLE', 'PDF not available for this book', 404)
    }

    // Free published books are available to any signed-in user.
    // Premium books require admin or an active entitlement.
    const requiresEntitlement = book.is_premium === true

    if (!isAdmin && requiresEntitlement) {
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
