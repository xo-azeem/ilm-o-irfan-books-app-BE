import { anonClient, requireMethod } from '../_shared/auth.ts'
import {
  CAROUSEL_FALLBACK_SLIDES,
  CAROUSEL_MAX_SLIDES,
  carouselSource,
} from '../_shared/carousel.ts'
import { withCarouselUrls } from '../_shared/covers.ts'
import { failFromDbError, handleError, handleOptions, ok, publicCache } from '../_shared/http.ts'

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

    // home_carousel returns the admin's live slides in the admin's order, or —
    // when there are none — this week's five-book fallback draw, so the rail
    // is never empty while the catalogue has anything published. Both come
    // back as carousel_items rows; fallback rows have a null slide_id.
    const { data, error } = await anonClient().rpc('home_carousel', {
      p_limit: CAROUSEL_MAX_SLIDES,
      p_fallback_limit: CAROUSEL_FALLBACK_SLIDES,
    })

    if (error) {
      return failFromDbError(
        'carousel-list',
        'CAROUSEL_READ_FAILED',
        'Unable to load the carousel',
        error,
      )
    }

    const rows = (data ?? []) as Record<string, unknown>[]

    // Same coverUrl / imageUrl contract as every other card the app receives.
    return ok(
      { slides: withCarouselUrls(rows), source: carouselSource(rows) },
      200,
      publicCache(CACHE_SECONDS),
    )
  } catch (error) {
    return handleError('carousel-list', error)
  }
})
