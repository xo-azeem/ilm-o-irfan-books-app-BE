import { assertEquals } from 'jsr:@std/assert@1'

import {
  catalogArgsFromRequest,
  splitCatalogRows,
} from '../supabase/functions/_shared/catalog-filters.ts'

const args = (search: string) =>
  catalogArgsFromRequest(new Request(`https://example.test/books-list${search}`), {
    limit: 20,
    offset: 0,
  })

Deno.test('no query string means no filters', () => {
  const parsed = args('')

  assertEquals(parsed.p_premium, null)
  assertEquals(parsed.p_min_rating, null)
  assertEquals(parsed.p_languages, null)
  assertEquals(parsed.p_lengths, null)
  assertEquals(parsed.p_sort, null)
  assertEquals(parsed.p_category, null)
})

Deno.test('premium accepts true/false and 1/0', () => {
  assertEquals(args('?premium=true').p_premium, true)
  assertEquals(args('?premium=false').p_premium, false)
  assertEquals(args('?premium=1').p_premium, true)
  assertEquals(args('?premium=0').p_premium, false)
})

Deno.test('an unparseable premium is ignored, not an error', () => {
  // An older app build must keep working against a newer deployment, so a
  // value the backend cannot read degrades to "no filter".
  assertEquals(args('?premium=maybe').p_premium, null)
  assertEquals(args('?premium=').p_premium, null)
})

Deno.test('minRating parses and clamps into the schema range', () => {
  assertEquals(args('?minRating=4').p_min_rating, 4)
  assertEquals(args('?minRating=4.5').p_min_rating, 4.5)
  // rating is CHECK (0..5); asking for 9 means "the best you have".
  assertEquals(args('?minRating=9').p_min_rating, 5)
  assertEquals(args('?minRating=-3').p_min_rating, 0)
  assertEquals(args('?minRating=abc').p_min_rating, null)
})

Deno.test('minRating accepts the snake_case spelling too', () => {
  assertEquals(args('?min_rating=3').p_min_rating, 3)
})

Deno.test('comma-separated values OR together within one parameter', () => {
  assertEquals(args('?language=urdu,english').p_languages, ['urdu', 'english'])
  assertEquals(args('?length=short,long').p_lengths, ['short', 'long'])
})

Deno.test('a repeated key is the same as a comma-separated list', () => {
  // Client HTTP libraries serialise arrays either way.
  assertEquals(args('?language=urdu&language=english').p_languages, ['urdu', 'english'])
})

Deno.test('unknown enum values are dropped, known ones survive', () => {
  assertEquals(args('?language=klingon').p_languages, null)
  assertEquals(args('?language=urdu,klingon').p_languages, ['urdu'])
  assertEquals(args('?length=enormous').p_lengths, null)
})

Deno.test('enum values are case and whitespace insensitive, and de-duplicated', () => {
  assertEquals(args('?language= Urdu , URDU ').p_languages, ['urdu'])
})

Deno.test('sort accepts the documented values and ignores anything else', () => {
  assertEquals(args('?sort=title').p_sort, 'title')
  assertEquals(args('?sort=RATING').p_sort, 'rating')
  assertEquals(args('?sort=banana').p_sort, null)
})

Deno.test('category passes through under any of its spellings', () => {
  assertEquals(args('?category=history').p_category, 'history')
  assertEquals(args('?categoryId=history').p_category, 'history')
  assertEquals(args('?category_id=history').p_category, 'history')
})

Deno.test('an unknown parameter changes nothing', () => {
  const parsed = args('?downloaded=true&foo=bar')

  assertEquals(parsed.p_premium, null)
  assertEquals(parsed.p_languages, null)
  assertEquals(parsed.p_sort, null)
})

Deno.test('the query term is supplied by the caller, not read from the URL', () => {
  // books-list ignores `q`; books-search requires it. Keeping it out of the
  // parser is what stops books-list from accidentally becoming a search.
  const listing = args('?q=jannat')
  assertEquals(listing.p_query, null)

  const searching = catalogArgsFromRequest(
    new Request('https://example.test/books-search?q=jannat'),
    { query: 'jannat', limit: 20, offset: 0 },
  )
  assertEquals(searching.p_query, 'jannat')
})

Deno.test('splitCatalogRows strips the window count off every row', () => {
  const { items, totalCount } = splitCatalogRows([
    { id: 'a', title: 'A', total_count: 42 },
    { id: 'b', title: 'B', total_count: 42 },
  ])

  assertEquals(totalCount, 42)
  assertEquals(items, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
})

Deno.test('an empty result is a zero count, not a missing one', () => {
  assertEquals(splitCatalogRows([]), { items: [], totalCount: 0 })
})
