import { assertEquals, assertThrows } from 'jsr:@std/assert@1'

import { BadRequestError } from '../supabase/functions/_shared/http.ts'
import {
  offsetFromIso,
  resolveTimeZone,
  resolveWriteTimeZone,
} from '../supabase/functions/_shared/timezone.ts'

Deno.test('tz is optional', () => {
  assertEquals(resolveTimeZone(undefined), null)
  assertEquals(resolveTimeZone(null), null)
  assertEquals(resolveTimeZone(''), null)
})

Deno.test('tz accepts IANA names and normalises case', () => {
  assertEquals(resolveTimeZone('Asia/Karachi'), 'Asia/Karachi')
  assertEquals(resolveTimeZone('asia/karachi'), 'Asia/Karachi')
  assertEquals(resolveTimeZone(' UTC '), 'UTC')
})

Deno.test('tz rejects names the runtime does not know', () => {
  assertThrows(() => resolveTimeZone('Mars/Olympus'), BadRequestError)
  assertThrows(() => resolveTimeZone(5), BadRequestError)
})

Deno.test('offsetFromIso reads an explicit numeric offset', () => {
  assertEquals(offsetFromIso('2026-09-13T23:30:00+05:00'), '+05:00')
  assertEquals(offsetFromIso('2026-09-13T23:30:00.123-04:30'), '-04:30')
  assertEquals(offsetFromIso('2026-09-13T23:30:00+0530'), '+05:30')
  assertEquals(offsetFromIso('2026-09-13T23:30:00+05'), '+05:00')
})

// toISOString() always emits Z, so Z is "no information", not "UTC".
Deno.test('offsetFromIso treats Z, +00:00 and no offset as unknown', () => {
  assertEquals(offsetFromIso('2026-09-13T18:30:00Z'), null)
  assertEquals(offsetFromIso('2026-09-13T18:30:00+00:00'), null)
  assertEquals(offsetFromIso('2026-09-13T18:30:00'), null)
  assertEquals(offsetFromIso(null), null)
  assertEquals(offsetFromIso(42), null)
})

Deno.test('offsetFromIso ignores offsets no zone uses', () => {
  assertEquals(offsetFromIso('2026-09-13T18:30:00+15:00'), null)
  assertEquals(offsetFromIso('2026-09-13T18:30:00+05:75'), null)
})

Deno.test('write zone: stamp offset first, then tz, then nothing', () => {
  assertEquals(
    resolveWriteTimeZone({ client_updated_at: '2026-09-13T23:30:00+05:00', tz: 'Europe/London' }),
    '+05:00',
  )
  assertEquals(
    resolveWriteTimeZone({ clientUpdatedAt: '2026-09-13T18:30:00Z', tz: 'Asia/Karachi' }),
    'Asia/Karachi',
  )
  assertEquals(resolveWriteTimeZone({ client_updated_at: '2026-09-13T18:30:00Z' }), null)
  assertEquals(resolveWriteTimeZone({}), null)
})

Deno.test('write zone: a bad tz is still a 400 when the stamp carries no offset', () => {
  assertThrows(
    () => resolveWriteTimeZone({ client_updated_at: '2026-09-13T18:30:00Z', tz: 'Nope/Nope' }),
    BadRequestError,
  )
})
