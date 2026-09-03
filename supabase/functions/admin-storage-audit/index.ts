import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const { data, error } = await ctx.supabase.rpc('admin_storage_audit')

    if (error) {
      return failFromDbError(
        'admin-storage-audit',
        'ADMIN_STORAGE_AUDIT_FAILED',
        'Unable to run storage audit',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return failUnexpected('admin-storage-audit', error)
  }
})
