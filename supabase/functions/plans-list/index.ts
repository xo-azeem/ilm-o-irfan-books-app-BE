import { anonClient, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    // Plan catalogues are a handful of rows by nature, so this stays unpaged
    // and returns the plain { data } shape the subscription screen expects.
    const { data, error } = await anonClient()
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(50)

    if (error) {
      return failFromDbError('plans-list', 'PLANS_READ_FAILED', 'Unable to load plans', error)
    }

    return ok(data ?? [])
  } catch (error) {
    return handleError('plans-list', error)
  }
})
