import { assertEquals } from 'jsr:@std/assert@1'

import {
  coverObjectKey,
  publicCoverUrl,
  withCoverUrl,
  withNestedBookCoverUrl,
} from '../supabase/functions/_shared/covers.ts'

Deno.test('coverObjectKey strips covers/ prefix and leading slashes', () => {
  assertEquals(coverObjectKey('covers/ihya.webp'), 'ihya.webp')
  assertEquals(coverObjectKey('/covers/ihya.webp'), 'ihya.webp')
  assertEquals(coverObjectKey('ihya.webp'), 'ihya.webp')
  assertEquals(coverObjectKey(''), null)
  assertEquals(coverObjectKey(null), null)
})

Deno.test('publicCoverUrl builds the public Storage URL', () => {
  Deno.env.set('SUPABASE_URL', 'https://abc.supabase.co/')
  assertEquals(
    publicCoverUrl('covers/ihya.webp'),
    'https://abc.supabase.co/storage/v1/object/public/covers/ihya.webp',
  )
  assertEquals(publicCoverUrl(null), null)
})

Deno.test('withCoverUrl attaches coverUrl beside cover_path', () => {
  Deno.env.set('SUPABASE_URL', 'https://abc.supabase.co')
  const out = withCoverUrl({ id: '1', cover_path: 'covers/a.webp', title: 'A' })
  assertEquals(out.coverUrl, 'https://abc.supabase.co/storage/v1/object/public/covers/a.webp')
  assertEquals(out.title, 'A')
})

Deno.test('withNestedBookCoverUrl only decorates the nested book', () => {
  Deno.env.set('SUPABASE_URL', 'https://abc.supabase.co')
  const out = withNestedBookCoverUrl({
    book_id: '1',
    book: { id: '1', cover_path: 'x.webp' },
  })
  assertEquals(
    (out.book as Record<string, unknown>).coverUrl,
    'https://abc.supabase.co/storage/v1/object/public/covers/x.webp',
  )
  assertEquals(out.book_id, '1')
})
