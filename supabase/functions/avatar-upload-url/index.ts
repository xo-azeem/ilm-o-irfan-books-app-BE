// Edge Function: avatar-upload-url
// JWT required. Mints a one-shot signed upload URL for the caller's own avatar.
//
// The avatars bucket is private and owner-scoped, so the app could upload
// straight through supabase-js. It does not, for two reasons:
//
//   1. the object key has to start with the user's id or the RLS policy rejects
//      the write, and every client that has to build that key is a client that
//      can get it wrong
//   2. the key is minted here, so it is always unique - overwriting a stale
//      avatar in place leaves every cached copy pointing at the old image
//
// The upload URL is single-use and the caller still has to send
// profile-update { avatar_path } afterwards; nothing here touches the profile.

import { requireMethod, requireUser, serviceClient } from '../_shared/auth.ts'
import {
  BadRequestError,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'

// Must stay a subset of the bucket's allowed_mime_types (see
// 20260726120200_storage_buckets.sql); Storage rejects anything else anyway,
// but it rejects it after the phone has uploaded the bytes.
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const contentType = String(payload.contentType ?? payload.content_type ?? 'image/jpeg')
      .toLowerCase()
      .trim()

    const extension = EXTENSION_BY_TYPE[contentType]

    if (!extension) {
      throw new BadRequestError(
        `contentType must be one of: ${Object.keys(EXTENSION_BY_TYPE).join(', ')}`,
      )
    }

    // The leading segment is what avatars_insert_own checks. It is taken from
    // the verified JWT, never from the request body.
    const path = `${ctx.user.id}/${crypto.randomUUID()}.${extension}`

    const { data, error } = await serviceClient()
      .storage.from('avatars')
      .createSignedUploadUrl(path)

    if (error || !data) {
      return failFromDbError(
        'avatar-upload-url',
        'AVATAR_UPLOAD_URL_FAILED',
        'Unable to create an avatar upload URL',
        error,
      )
    }

    return ok({
      path,
      signedUrl: data.signedUrl,
      token: data.token,
      contentType,
      // Storage fixes the upload-token lifetime at two hours; surfaced so the
      // client can decide whether to reuse a URL or ask for a fresh one.
      expiresIn: 7200,
    })
  } catch (error) {
    return handleError('avatar-upload-url', error)
  }
})
