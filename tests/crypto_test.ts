import { assertEquals } from 'jsr:@std/assert@1'

import { timingSafeEqualString } from '../supabase/functions/_shared/crypto.ts'

Deno.test('timingSafeEqualString accepts exact matches only', () => {
  assertEquals(timingSafeEqualString('Bearer secret', 'Bearer secret'), true)
  assertEquals(timingSafeEqualString('Bearer secret', 'Bearer secretx'), false)
  assertEquals(timingSafeEqualString(null, 'Bearer secret'), false)
  assertEquals(timingSafeEqualString('', 'Bearer secret'), false)
  assertEquals(timingSafeEqualString('Bearer secret', 'Bearer SECRET'), false)
})
