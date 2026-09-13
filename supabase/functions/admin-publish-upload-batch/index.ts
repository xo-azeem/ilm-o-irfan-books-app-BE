import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { requireUuidField } from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

// Publishes every book in one bulk upload at once. The RPC writes the books
// into the batch's destination collection/category first, then goes through
// admin_bulk_update_books, so a title whose PDF never reached storage is
// skipped and reported rather than put live.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const batchId = requireUuidField(payload, ['batchId', 'batch_id', 'id'], 'batchId')

    const { data, error } = await ctx.supabase.rpc('admin_publish_upload_batch', {
      p_batch_id: batchId,
    })

    if (error) {
      return failFromRpcError(
        'admin-publish-upload-batch',
        'ADMIN_PUBLISH_UPLOAD_BATCH_FAILED',
        'Unable to publish the upload batch',
        error,
      )
    }

    return ok({ batchId, ...(data as Record<string, unknown>) })
  } catch (error) {
    return handleError('admin-publish-upload-batch', error)
  }
})
