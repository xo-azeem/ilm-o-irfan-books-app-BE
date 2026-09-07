import { anonClient, requireMethod } from '../_shared/auth.ts'
import { failFromDbError, handleError, handleOptions, ok, publicCache } from '../_shared/http.ts'

// The carousel is small by design — a rail nobody swipes to the end of is a
// rail nobody sees the end of — and an admin who adds a 40th slide should not
// be able to make Home load 40 covers.
const MAX_SLIDES = 20

// Editorial changes should reach the app in about a minute, not instantly. The
// carousel is the same bytes for every caller, so caching it is what stops the
// most-requested query in the product from being answered from scratch on every
// cold app start.
const CACHE_SECONDS = 60

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    // carousel_items already filters to active, in-window slides whose book is
    // published, and RLS enforces the same thing a second time on the table
    // underneath. Ordering is the admin's, not ours.
    const { data, error } = await anonClient()
      .from('carousel_items')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('slide_id', { ascending: true })
      .limit(MAX_SLIDES)

    if (error) {
      return failFromDbError(
        'carousel-list',
        'CAROUSEL_READ_FAILED',
        'Unable to load the carousel',
        error,
      )
    }

    return ok({ slides: data ?? [] }, 200, publicCache(CACHE_SECONDS))
  } catch (error) {
    return handleError('carousel-list', error)
  }
})
