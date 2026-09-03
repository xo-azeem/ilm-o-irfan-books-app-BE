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
import { asOptionalText } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'DELETE'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const bucket = asOptionalText('bucket')(payload.bucket)
    const name = asOptionalText('name')(payload.name ?? payload.path)

    if (bucket !== 'covers' && bucket !== 'pdfs') {
      return fail('INVALID_REQUEST', 'bucket must be covers or pdfs', 400)
    }

    if (!name) {
      return fail('INVALID_REQUEST', 'name is required', 400)
    }

    const { error } = await ctx.supabase.rpc('admin_delete_storage_object', {
      p_bucket: bucket,
      p_name: name,
    })

    if (error) {
      return failFromDbError(
        'admin-delete-storage-object',
        'ADMIN_DELETE_STORAGE_FAILED',
        'Unable to delete storage object',
        error,
      )
    }

    return ok({ bucket, name, deleted: true })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-delete-storage-object', error)
  }
})
