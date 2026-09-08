// Edge Function: get-signed-pdf
// JWT required. Admins may preview drafts.
//
// The catalogue is subscription-only: every title requires a membership.
// Access is granted on exactly these conditions, and there is no other:
//   - JWT / profile role is admin, or
//   - the book is published and the user has an active entitlement
//
// is_premium is deliberately NOT consulted. It used to carve out a "free and
// published" branch, which meant a single unset flag - one bulk-action
// misclick, one importer default, one seed script - silently handed a paid PDF
// to every signed-in reader. The flag still labels a book in the catalogue,
// but it stopped being load-bearing for access, so getting it wrong is now a
// merchandising bug rather than a revenue hole.
//
// The former ALLOW_PDF_WITHOUT_ENTITLEMENT env flag and the
// app_settings.allow_pdf_without_entitlement column are both gone for the same
// reason. Either one could open the paywall globally from a place no code
// review would look, and the app has no way to observe them. If the paywall
// ever needs opening, that is a product decision that belongs in entitlements,
// not a hidden switch.

import { requireMethod, requireUser, serviceClient } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
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
        // is_premium is not selected: it no longer decides anything here, and
        // reading it would invite someone to branch on it again.
        .select('id, title, pdf_path, is_published, file_size_bytes')
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

    // Every book requires a membership. Admins are the only exception, and
    // they are served drafts too - the app relies on that for previews.
    if (!isAdmin) {
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
    return handleError('get-signed-pdf', error)
  }
})
