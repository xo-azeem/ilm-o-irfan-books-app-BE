import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
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

    // The database only clears the delete: admin, managed bucket, and nothing
    // still pointing at the object. Rows in storage.objects cannot be deleted
    // with SQL (Storage's protect_objects_delete trigger), so the object itself
    // goes through the Storage API under the admin delete policies.
    const { data: exists, error } = await ctx.supabase.rpc('admin_delete_storage_object', {
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

    if (exists) {
      const { error: removeError } = await ctx.supabase.storage.from(bucket).remove([name])
      if (removeError) {
        return fail('ADMIN_DELETE_STORAGE_FAILED', removeError.message, 500)
      }
    }

    return ok({ bucket, name, deleted: Boolean(exists) })
  } catch (error) {
    return handleError('admin-delete-storage-object', error)
  }
})
