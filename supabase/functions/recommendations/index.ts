import { requireMethod, requireUser } from '../_shared/auth.ts'
import { handleError, handleOptions, ok } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import { normalizePageSize } from '../_shared/pagination.ts'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

// How many "Because you read X" rails to build. Three is what Home has room
// for; the flat `books` list carries the rest for a see-all screen.
const DEFAULT_SECTIONS = 3
const MAX_SECTIONS = 6

const DEFAULT_PER_SECTION = 10
const MAX_PER_SECTION = 20

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)
    const limit = normalizePageSize(
      url.searchParams.get('limit') ?? undefined,
      DEFAULT_LIMIT,
      MAX_LIMIT,
    )
    const sections = normalizePageSize(
      url.searchParams.get('sections') ?? undefined,
      DEFAULT_SECTIONS,
      MAX_SECTIONS,
    )
    const perSection = normalizePageSize(
      url.searchParams.get('perSection') ?? undefined,
      DEFAULT_PER_SECTION,
      MAX_PER_SECTION,
    )

    // Called with the caller's own JWT: recommendations_for_me() reads
    // auth.uid() and takes no user id, so there is no argument to tamper with
    // and no way to ask for somebody else's taste profile.
    //
    // The RPC rebuilds the profile itself when it has gone stale, which is why
    // this is a single call and not a check-then-build pair. Nothing here is
    // cacheable: every byte of it is specific to one user.
    const { data, error } = await ctx.supabase.rpc('recommendations_for_me', {
      p_limit: limit,
      p_sections: sections,
      p_per_section: perSection,
    })

    if (error) {
      return failFromRpcError(
        'recommendations',
        'RECOMMENDATIONS_READ_FAILED',
        'Unable to load recommendations',
        error,
      )
    }

    return ok(data ?? { generatedAt: null, isPersonalized: false, sections: [], books: [] })
  } catch (error) {
    return handleError('recommendations', error)
  }
})
