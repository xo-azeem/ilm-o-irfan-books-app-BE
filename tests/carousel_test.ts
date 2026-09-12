import { assertEquals } from 'jsr:@std/assert@1'

import { carouselSource } from '../supabase/functions/_shared/carousel.ts'

// The RPC's contract: an admin slide always has a slide_id, a fallback row never
// does. The label the app gets is derived from that and nothing else.

Deno.test('admin slides are labelled admin', () => {
  assertEquals(carouselSource([{ slide_id: 'a' }, { slide_id: 'b' }]), 'admin')
})

Deno.test('fallback rows (null slide_id) are labelled fallback', () => {
  assertEquals(carouselSource([{ slide_id: null }, { slide_id: null }]), 'fallback')
  assertEquals(carouselSource([{ book_id: 'x' }]), 'fallback', 'a missing key counts as null')
})

Deno.test('an empty carousel is admin: there is no fallback to point at', () => {
  assertEquals(carouselSource([]), 'admin')
})
