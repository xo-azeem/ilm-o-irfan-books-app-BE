import { assertEquals, assertThrows } from 'jsr:@std/assert@1'

import { BadRequestError } from '../supabase/functions/_shared/http.ts'
import {
  clampCurrentPage,
  hasAny,
  resolveClientUpdatedAt,
  resolveProgress,
} from '../supabase/functions/_shared/progress.ts'

Deno.test('omitting progress entirely means "leave it alone"', () => {
  assertEquals(resolveProgress({ book_id: 'x' }), undefined)
})

Deno.test('progress is read on the 0-1 scale the column stores', () => {
  assertEquals(resolveProgress({ progress: 0 }), 0)
  assertEquals(resolveProgress({ progress: 0.5 }), 0.5)
  assertEquals(resolveProgress({ progress: 1 }), 1)
})

Deno.test('progress_percent is converted, not guessed', () => {
  assertEquals(resolveProgress({ progress_percent: 0 }), 0)
  assertEquals(resolveProgress({ progress_percent: 50 }), 0.5)
  assertEquals(resolveProgress({ progressPercent: 100 }), 1)
})

// The regression this whole split exists for: on the old heuristic, a reader one
// page into a book sent progress: 1 and the book was marked finished.
Deno.test('progress: 1 is finished, and 1 percent has to say so', () => {
  assertEquals(resolveProgress({ progress: 1 }), 1)
  assertEquals(resolveProgress({ progress_percent: 1 }), 0.01)
})

Deno.test('an out-of-range value is rejected instead of being rescaled', () => {
  assertThrows(() => resolveProgress({ progress: 42 }), BadRequestError)
  assertThrows(() => resolveProgress({ progress: -0.1 }), BadRequestError)
  assertThrows(() => resolveProgress({ progress_percent: 101 }), BadRequestError)
  assertThrows(() => resolveProgress({ progress: 'half' }), BadRequestError)
  assertThrows(() => resolveProgress({ progress: Number.NaN }), BadRequestError)
})

Deno.test('sending both scales is ambiguous and refused', () => {
  assertThrows(() => resolveProgress({ progress: 0.5, progress_percent: 50 }), BadRequestError)
})

Deno.test('values are rounded to the numeric(5,4) the column accepts', () => {
  assertEquals(resolveProgress({ progress: 0.123456789 }), 0.1235)
  assertEquals(resolveProgress({ progress_percent: 33.333333 }), 0.3333)
})

Deno.test('hasAny is what tells a partial write from an omitted field', () => {
  assertEquals(hasAny({ currentPage: 4 }, ['current_page', 'currentPage']), true)
  assertEquals(hasAny({ current_page: null }, ['current_page']), true, 'explicit null still counts')
  assertEquals(hasAny({ book_id: 'x' }, ['current_page', 'currentPage']), false)
})

Deno.test('client_updated_at is optional and null-able', () => {
  assertEquals(resolveClientUpdatedAt({ book_id: 'x' }), null)
  assertEquals(resolveClientUpdatedAt({ client_updated_at: null }), null)
  assertEquals(resolveClientUpdatedAt({ clientUpdatedAt: '' }), null)
})

Deno.test('client_updated_at is normalised to UTC ISO-8601', () => {
  const now = Date.parse('2026-09-12T12:00:00.000Z')
  assertEquals(
    resolveClientUpdatedAt({ client_updated_at: '2026-09-12T10:22:31.000Z' }, now),
    '2026-09-12T10:22:31.000Z',
  )
  // A local offset means the same instant as its UTC form.
  assertEquals(
    resolveClientUpdatedAt({ clientUpdatedAt: '2026-09-12T15:22:31+05:00' }, now),
    '2026-09-12T10:22:31.000Z',
  )
})

Deno.test('client_updated_at rejects garbage and far-future clocks', () => {
  const now = Date.parse('2026-09-12T12:00:00.000Z')
  assertThrows(
    () => resolveClientUpdatedAt({ client_updated_at: 'yesterday' }, now),
    BadRequestError,
  )
  assertThrows(
    () => resolveClientUpdatedAt({ client_updated_at: 1757672551 }, now),
    BadRequestError,
  )
  assertThrows(
    () => resolveClientUpdatedAt({ client_updated_at: '2026-09-14T12:00:01.000Z' }, now),
    BadRequestError,
  )
  // A few minutes of skew is normal and accepted.
  assertEquals(
    resolveClientUpdatedAt({ client_updated_at: '2026-09-12T12:03:00.000Z' }, now),
    '2026-09-12T12:03:00.000Z',
  )
})

Deno.test('one page past the end is clamped, further is rejected', () => {
  assertEquals(clampCurrentPage(42, 310), 42)
  assertEquals(clampCurrentPage(310, 310), 310)
  assertEquals(clampCurrentPage(311, 310), 310)
  assertEquals(clampCurrentPage(999, null), 999, 'no total to clamp against')
  assertThrows(() => clampCurrentPage(312, 310), BadRequestError)
})
