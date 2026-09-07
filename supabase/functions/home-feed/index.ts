import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCarouselUrls, withCoverUrls } from '../_shared/covers.ts'
import { failFromDbError, handleError, handleOptions, ok } from '../_shared/http.ts'

type BookCard = Record<string, unknown> & { id: string }

// The app slices Trending to 10. Asking for 12 leaves headroom so a catalogue
// that briefly dips below 12 titles still fills the rail.
const TRENDING_LIMIT = 12

const CAROUSEL_LIMIT = 20

// hero and newArrivals stay curated collections, as they have been. Only
// `trending` moved to the weekly draw, because trending was the one rail
// claiming to describe the catalogue rather than an editor's shelf.
async function booksForCollectionSlug(
  supabase: ReturnType<typeof anonClient>,
  slug: string,
  limit = 12,
): Promise<BookCard[]> {
  const { data: col, error: colError } = await supabase
    .from('collections')
    .select('id')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()

  if (colError) {
    throw colError
  }

  if (!col) {
    return []
  }

  const { data: membership, error: memError } = await supabase
    .from('collection_books')
    .select('book_id, sort_order')
    .eq('collection_id', col.id)
    .order('sort_order', { ascending: true })
    .limit(limit)

  if (memError) {
    throw memError
  }

  const ids = (membership ?? []).map((row) => row.book_id).filter(Boolean)
  if (ids.length === 0) {
    return []
  }

  const { data: books, error: booksError } = await supabase
    .from('book_list_items')
    .select('*')
    .in('id', ids)

  if (booksError) {
    throw booksError
  }

  const byId = new Map((books ?? []).map((book) => [book.id as string, book as BookCard]))
  return ids.map((id) => byId.get(id)).filter((book): book is BookCard => Boolean(book))
}

// Trending is a random draw over the whole published catalogue, made once a
// week by the database and stored, so every user sees the same titles until
// Monday 00:00 UTC. Neither the app nor an editor picks them.
//
// A failure here is not worth failing the whole screen over, so it degrades to
// the newest-books list the response already carries.
async function weeklyTrending(
  supabase: ReturnType<typeof anonClient>,
  fallback: BookCard[],
): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc('weekly_trending_books', {
    p_limit: TRENDING_LIMIT,
  })

  if (error) {
    console.error('[home-feed] trending draw failed', error.code ?? '', error.message ?? error)
    return fallback.slice(0, TRENDING_LIMIT)
  }

  return (data ?? []) as BookCard[]
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const supabase = anonClient()

    const [collectionsRes, booksRes, categoriesRes, settingsRes, carouselRes] = await Promise.all([
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

    let hero: BookCard[] = []
    let newArrivals: BookCard[] = []

    try {
      ;[hero, newArrivals] = await Promise.all([
        booksForCollectionSlug(supabase, 'home-hero', 8),
        booksForCollectionSlug(supabase, 'new-arrivals', 12),
      ])
    } catch (shelfError) {
      return failFromDbError(
        'home-feed',
        'HOME_FEED_READ_FAILED',
        'Unable to load home shelves',
        shelfError as { message?: string; code?: string },
      )
    }

    const newest = (booksRes.data ?? []) as BookCard[]
    const trending = await weeklyTrending(supabase, newest)

    // hero and newArrivals are curated collections, so empty membership falls
    // back to the newest published books and Home is never blank. `trending`
    // needs no such fallback: the weekly draw already covers the catalogue.
    if (newArrivals.length === 0) {
      newArrivals = newest
    }
    if (hero.length === 0) {
      hero = newest.slice(0, 5)
    }

    return ok({
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
    })
  } catch (error) {
    return handleError('home-feed', error)
  }
})
