import { assertEquals, assertThrows } from 'jsr:@std/assert@1'

import { BadRequestError } from '../supabase/functions/_shared/http.ts'
import { hasAny, resolveProgress } from '../supabase/functions/_shared/progress.ts'

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
