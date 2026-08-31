import { anonClient } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'

type BookCard = Record<string, unknown> & { id: string }

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

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabase = anonClient()

    const [collectionsRes, booksRes, categoriesRes, settingsRes] = await Promise.all([
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
        .select('featured_collection_id')
        .eq('id', 1)
        .maybeSingle(),
    ])

    const failed = [
      ['collections', collectionsRes.error] as const,
      ['books', booksRes.error] as const,
      ['categories', categoriesRes.error] as const,
      ['settings', settingsRes.error] as const,
    ].find(([, error]) => error)

    if (failed) {
      return failFromDbError('home-feed', 'HOME_FEED_READ_FAILED', 'Unable to load home feed', failed[1])
    }

    let hero: BookCard[] = []
    let trending: BookCard[] = []
    let newArrivals: BookCard[] = []

    try {
      ;[hero, trending, newArrivals] = await Promise.all([
        booksForCollectionSlug(supabase, 'home-hero', 8),
        booksForCollectionSlug(supabase, 'trending', 12),
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

    // If shelves are empty (no membership yet), fall back to newest published books.
    const newest = (booksRes.data ?? []) as BookCard[]
    if (newArrivals.length === 0) {
      newArrivals = newest
    }
    if (trending.length === 0) {
      trending = newest
    }
    if (hero.length === 0) {
      hero = newest.slice(0, 5)
    }

    return ok({
      collections: collectionsRes.data ?? [],
      books: newest,
      categories: categoriesRes.data ?? [],
      featuredCollectionId: settingsRes.data?.featured_collection_id ?? null,
      shelves: {
        hero,
        trending,
        newArrivals,
      },
    })
  } catch (error) {
    return failUnexpected('home-feed', error)
  }
})
