import { anonClient } from '../_shared/auth.ts'
import { failFromDbError, failUnexpected, handleOptions, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabase = anonClient()

    const [collectionsRes, booksRes, categoriesRes] = await Promise.all([
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
    ])

    const failed = [
      ['collections', collectionsRes.error] as const,
      ['books', booksRes.error] as const,
      ['categories', categoriesRes.error] as const,
    ].find(([, error]) => error)

    if (failed) {
      return failFromDbError('home-feed', 'HOME_FEED_READ_FAILED', 'Unable to load home feed', failed[1])
    }

    return ok({
      collections: collectionsRes.data ?? [],
      books: booksRes.data ?? [],
      categories: categoriesRes.data ?? [],
    })
  } catch (error) {
    return failUnexpected('home-feed', error)
  }
})
