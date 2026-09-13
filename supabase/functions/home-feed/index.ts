import { anonClient, requireMethod } from '../_shared/auth.ts'
import {
  CAROUSEL_FALLBACK_SLIDES,
  CAROUSEL_MAX_SLIDES,
  carouselSource,
} from '../_shared/carousel.ts'
import {
  asCollectionPage,
  type BookCard,
  type CollectionPage,
  type CollectionSource,
  fetchCollectionPage,
  HOME_RAIL_LIMIT,
  NEW_ARRIVALS_SLUG,
  TRENDING_SLUG,
} from '../_shared/collections.ts'
import { withCarouselUrls, withCoverUrls } from '../_shared/covers.ts'
import {
  CATALOGUE_CACHE_SECONDS,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  publicCache,
} from '../_shared/http.ts'

// What the app needs to open a rail's full page and label its "See all".
// collectionId is null when the rail is not backed by a collection row right
// now (hidden by an admin, or degraded after a failed read).
type ShelfMeta = {
  collectionId: string | null
  slug: string
  totalCount: number
  source: CollectionSource
}

function shelfMeta(slug: string, page: CollectionPage | null): ShelfMeta {
  return {
    collectionId: page?.collection.id ?? null,
    slug,
    totalCount: page?.totalCount ?? 0,
    source: page?.source ?? 'curated',
  }
}

// `trending` and `newArrivals` are the first page of collection_page(), the
// same read collection-books serves, so the rail and its "See all" page are
// one list. `hero` stays the curated home-hero shelf with its newest fallback.
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
      // The strip is for admin-made collections. The three system shelves
      // have rails of their own above it, so they are left out here.
      supabase
        .from('collection_summaries')
        .select('*')
        .eq('is_system', false)
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
      // Admin slides when there are any, else this week's fallback draw.
      supabase.rpc('home_carousel', {
        p_limit: CAROUSEL_MAX_SLIDES,
        p_fallback_limit: CAROUSEL_FALLBACK_SLIDES,
      }),
      supabase.rpc('collection_shelf', { p_slug: 'home-hero', p_limit: 8 }),
      fetchCollectionPage(supabase, { slug: NEW_ARRIVALS_SLUG }, 0, HOME_RAIL_LIMIT),
      fetchCollectionPage(supabase, { slug: TRENDING_SLUG }, 0, HOME_RAIL_LIMIT),
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
    const newest = (booksRes.data ?? []) as BookCard[]
    const carousel = (carouselRes.data ?? []) as Record<string, unknown>[]

    // null here means the collection row is hidden or missing: the rail is
    // empty on purpose, and the app has no page to open for it.
    const newArrivalsPage = asCollectionPage(newArrivalsRes.data)
    const newArrivals = newArrivalsPage?.books ?? []

    // A failed draw is not worth failing the whole screen over: it degrades to
    // the newest-books list the response already carries, with no page to
    // open, so the app does not offer a "See all" that would fail too.
    let trendingPage: CollectionPage | null
    let trending: BookCard[]
    let trendingMeta: ShelfMeta
    if (trendingRes.error) {
      console.error(
        '[home-feed] trending read failed',
        trendingRes.error.code ?? '',
        trendingRes.error.message ?? trendingRes.error,
      )
      trending = newest.slice(0, HOME_RAIL_LIMIT)
      trendingMeta = {
        collectionId: null,
        slug: TRENDING_SLUG,
        totalCount: trending.length,
        source: 'newest',
      }
    } else {
      trendingPage = asCollectionPage(trendingRes.data)
      trending = trendingPage?.books ?? []
      trendingMeta = shelfMeta(TRENDING_SLUG, trendingPage)
    }

    // hero is a curated collection, so empty membership falls back to the
    // newest published books and the top of Home is never blank.
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
        // Admin-managed, with a weekly random fallback when the admin has set
        // nothing. Empty only when the catalogue itself is empty (or the read
        // failed); the app never invents a carousel of its own.
        carousel: withCarouselUrls(carousel),
        carouselSource: carouselSource(carousel),
        shelves: {
          hero: withCoverUrls(hero),
          trending: withCoverUrls(trending),
          newArrivals: withCoverUrls(newArrivals),
        },
        // Where each rail's "See all" goes and how many it will find there:
        // collection-books?id=<collectionId> pages the same list.
        shelvesMeta: {
          trending: trendingMeta,
          newArrivals: shelfMeta(NEW_ARRIVALS_SLUG, newArrivalsPage),
        },
      },
      200,
      publicCache(CATALOGUE_CACHE_SECONDS),
    )
  } catch (error) {
    return handleError('home-feed', error)
  }
})
