import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asBoolean, requireUuidArrayField } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const ids = requireUuidArrayField(payload, ['ids', 'bookIds', 'book_ids'], 'ids')

    const hasPublished =
      Object.hasOwn(payload, 'is_published') || Object.hasOwn(payload, 'isPublished')
    const hasPremium = Object.hasOwn(payload, 'is_premium') || Object.hasOwn(payload, 'isPremium')

    if (!hasPublished && !hasPremium) {
      return fail('INVALID_REQUEST', 'Provide is_published and/or is_premium', 400)
    }

    const p_is_published = hasPublished
      ? asBoolean('is_published')(payload.is_published ?? payload.isPublished)
      : null
    const p_is_premium = hasPremium
      ? asBoolean('is_premium')(payload.is_premium ?? payload.isPremium)
      : null

    const { data, error } = await ctx.supabase.rpc('admin_bulk_update_books', {
      p_ids: ids,
      p_is_published,
      p_is_premium,
    })

    if (error) {
      return failFromDbError(
        'admin-bulk-update-books',
        'ADMIN_BULK_UPDATE_FAILED',
        'Unable to bulk update books',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-bulk-update-books', error)
  }
})
