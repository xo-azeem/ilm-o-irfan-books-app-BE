// The one read behind a collection's book list.
//
// home-feed's Trending / New arrivals rails and collection-books' pages used
// to be built from different queries, so "See all" on a full rail could open
// an empty page. Both now call collection_page(), which resolves the
// collection and picks the list in SQL:
//
//   trending      this week's draw, in draw order         source = 'weekly'
//   new-arrivals  curated members, else newest published  source = 'curated' | 'newest'
//   anything else curated members in admin sort_order     source = 'curated'
//
// `null` means the collection does not exist or is unpublished. Hiding a
// system shelf in the CMS therefore hides its rail on Home as well as its
// page, which is the only thing "hide" could sensibly mean for one of them.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type CollectionSource = 'curated' | 'weekly' | 'newest'

export type CollectionMeta = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  kind: string
  sort_order: number
  is_system: boolean
}

export type BookCard = Record<string, unknown> & { id: string }

export type CollectionPage = {
  collection: CollectionMeta
  source: CollectionSource
  totalCount: number
  books: BookCard[]
}

export type CollectionRef = { id: string } | { slug: string }

// What home-feed renders per rail: exactly this many, no over-fetch, so the
// rail is the first page of the list "See all" opens.
export const HOME_RAIL_LIMIT = 10

// Kept in step with public.system_collection_slugs(). The database is the
// authority (the views expose is_system); this is only for the meta a rail
// still has to carry when its collection row is hidden.
export const TRENDING_SLUG = 'trending'
export const NEW_ARRIVALS_SLUG = 'new-arrivals'

export function collectionPageArgs(
  ref: CollectionRef,
  offset: number,
  limit: number,
): Record<string, unknown> {
  return {
    ...('id' in ref ? { p_id: ref.id } : { p_slug: ref.slug }),
    p_offset: offset,
    p_limit: limit,
  }
}

export function fetchCollectionPage(
  supabase: SupabaseClient,
  ref: CollectionRef,
  offset: number,
  limit: number,
) {
  return supabase.rpc('collection_page', collectionPageArgs(ref, offset, limit))
}

export function asCollectionPage(data: unknown): CollectionPage | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const page = data as Partial<CollectionPage>
  if (!page.collection || typeof page.collection !== 'object') return null

  return {
    collection: page.collection,
    source: page.source ?? 'curated',
    totalCount: typeof page.totalCount === 'number' ? page.totalCount : 0,
    books: Array.isArray(page.books) ? (page.books as BookCard[]) : [],
  }
}
