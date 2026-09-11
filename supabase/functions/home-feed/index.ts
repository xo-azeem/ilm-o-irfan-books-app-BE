import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCarouselUrls, withCoverUrls } from '../_shared/covers.ts'
import { failFromDbError, handleError, handleOptions, ok, publicCache, CATALOGUE_CACHE_SECONDS } from '../_shared/http.ts'

type BookCard = Record<string, unknown> & { id: string }

// The app slices Trending to 10. Asking for 12 leaves headroom so a catalogue
// that briefly dips below 12 titles still fills the rail.
const TRENDING_LIMIT = 12

const CAROUSEL_LIMIT = 20

// hero and newArrivals stay curated collections, as they have been. Only
// `trending` moved to the weekly draw, because trending was the one rail
// claiming to describe the catalogue rather than an editor's shelf.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const supabase = anonClient()

    // Everything Home needs, in one parallel batch. Nothing below depends on
    // anything else here, so serial depth is one round trip, not five.
    const [
      collectionsRes,
      booksRes,
      categoriesRes,
      settingsRes,
      carouselRes,
      heroRes,
      newArrivalsRes,
      trendingRes,
    ] = await Promise.all([
      supabase
        .from('collection_summaries')
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: true })
        .limit(20),
      supabase
        .from('book_list_items')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(12),
      supabase
        .from('category_with_counts')
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: true })
        .limit(10),
      supabase
        .from('app_settings')
        .select('featured_collection_id, support_email')
        .eq('id', 1)
        .maybeSingle(),
      // The carousel ships inside home-feed as well as on its own endpoint. It
      // is the first thing on the screen, and a second round trip to fill it is
      // a second chance for Home to render half-empty on a slow connection.
      supabase
        .from('carousel_items')
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('slide_id', { ascending: true })
        .limit(CAROUSEL_LIMIT),
      supabase.rpc('collection_shelf', { p_slug: 'home-hero', p_limit: 8 }),
      supabase.rpc('collection_shelf', { p_slug: 'new-arrivals', p_limit: 12 }),
      supabase.rpc('weekly_trending_books', { p_limit: TRENDING_LIMIT }),
    ])

    const failed = [
      ['collections', collectionsRes.error] as const,
      ['books', booksRes.error] as const,
      ['categories', categoriesRes.error] as const,
      ['settings', settingsRes.error] as const,
    ].find(([, error]) => error)

    if (failed) {
      return failFromDbError(
        'home-feed',
        'HOME_FEED_READ_FAILED',
        'Unable to load home feed',
        failed[1],
      )
    }

    // The carousel is decoration on top of a screen that still works without
    // it, so unlike the four reads above it degrades to empty rather than
    // taking Home down with it.
    if (carouselRes.error) {
      console.error(
        '[home-feed] carousel read failed',
        carouselRes.error.code ?? '',
        carouselRes.error.message ?? carouselRes.error,
      )
    }

    if (heroRes.error || newArrivalsRes.error) {
      return failFromDbError(
        'home-feed',
        'HOME_FEED_READ_FAILED',
        'Unable to load home shelves',
        (heroRes.error ?? newArrivalsRes.error) as { message?: string; code?: string },
      )
    }

    let hero = (heroRes.data ?? []) as BookCard[]
    let newArrivals = (newArrivalsRes.data ?? []) as BookCard[]

    const newest = (booksRes.data ?? []) as BookCard[]

    // A failed draw is not worth failing the whole screen over: it degrades to
    // the newest-books list the response already carries.
    let trending: BookCard[]
    if (trendingRes.error) {
      console.error(
        '[home-feed] trending draw failed',
        trendingRes.error.code ?? '',
        trendingRes.error.message ?? trendingRes.error,
      )
      trending = newest.slice(0, TRENDING_LIMIT)
    } else {
      trending = (trendingRes.data ?? []) as BookCard[]
    }

    // hero and newArrivals are curated collections, so empty membership falls
    // back to the newest published books and Home is never blank. `trending`
    // needs no such fallback: the weekly draw already covers the catalogue.
    if (newArrivals.length === 0) {
      newArrivals = newest
    }
    if (hero.length === 0) {
      hero = newest.slice(0, 5)
    }

    // Same bytes for every caller until an admin edits a shelf. Without this,
    // json()'s `no-store` default makes the most-hit screen in the app the one
    // that can never be served from cache.
    return ok(
      {
        collections: collectionsRes.data ?? [],
        books: withCoverUrls(newest),
        categories: categoriesRes.data ?? [],
        featuredCollectionId: settingsRes.data?.featured_collection_id ?? null,
        supportEmail: settingsRes.data?.support_email ?? null,
        // Admin-managed. Empty means the admin has not put anything there, not
        // that the app should invent a carousel of its own.
        carousel: withCarouselUrls((carouselRes.data ?? []) as Record<string, unknown>[]),
        shelves: {
          hero: withCoverUrls(hero),
          trending: withCoverUrls(trending),
          newArrivals: withCoverUrls(newArrivals),
        },
      },
      200,
      publicCache(CATALOGUE_CACHE_SECONDS),
    )
  } catch (error) {
    return handleError('home-feed', error)
  }
})
