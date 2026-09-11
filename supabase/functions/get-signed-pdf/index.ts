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
import { type AccessState, clampSignedUrlTtl } from '../_shared/entitlement.ts'

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

    // Access state and the book row are independent reads.
    //
    // user_access_state() is the same rule entitlements-status reports, so the
    // app can never be shown an unlocked book it is then refused - the two
    // used to test `status = 'active'` separately and disagreed about trials
    // and cancelled-but-paid-for months.
    const [stateRes, bookRes] = await Promise.all([
      admin.rpc('user_access_state', { p_user_id: ctx.user.id }),
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

    if (stateRes.error) {
      return failFromDbError(
        'get-signed-pdf',
        'ENTITLEMENT_READ_FAILED',
        'Unable to verify subscription',
        stateRes.error,
      )
    }

    const state = stateRes.data as AccessState | null

    // No state means the rule could not be evaluated. Fail closed: an
    // unreadable entitlement is not a reason to hand out a PDF.
    if (!state) {
      return failFromDbError(
        'get-signed-pdf',
        'ENTITLEMENT_READ_FAILED',
        'Unable to verify subscription',
        { message: 'user_access_state returned null' },
      )
    }

    // The JWT claim still stands on its own so a real admin is not locked out
    // by a profiles read that went wrong.
    const isAdmin = state.isAdmin

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
    if (!isAdmin && !state.isActive) {
      return fail('PREMIUM_REQUIRED', 'Active subscription required', 403)
    }

    // A signed URL must not outlive the subscription that justified it.
    // Without this clamp, asking for a book ten seconds before expiry buys a
    // full five minutes of reading - and unlike the app's own lock, a minted
    // URL cannot be recalled: it already works from any client, offline of
    // any session. Admins have no end date and are not clamped.
    const expiresIn = clampSignedUrlTtl(
      Number(Deno.env.get('SIGNED_PDF_EXPIRES_IN') ?? '300'),
      isAdmin ? null : state.secondsRemaining,
    )
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

      // Opening a book is the moment the reader is most likely to be in the
      // app and least likely to tolerate a stale lock, so the countdown is
      // re-anchored here rather than waiting for the next entitlements-status
      // poll. serverTime travels with it so the client can re-measure its own
      // clock offset on every open.
      access: {
        expiresAt: state.expiresAt,
        secondsRemaining: isAdmin ? null : state.secondsRemaining,
        serverTime: state.serverTime,
        reason: state.reason,
      },
    })
  } catch (error) {
    return handleError('get-signed-pdf', error)
  }
})
