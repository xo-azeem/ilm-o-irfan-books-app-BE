import { assertEquals, assertThrows } from 'jsr:@std/assert@1'

import {
  assertOffsetInRange,
  buildCursorPagination,
  getPaginationRange,
  MAX_OFFSET,
  normalizePage,
  normalizePageSize,
  paginate,
  parsePaginationQuery,
  rangeFromRequest,
} from '../supabase/functions/_shared/pagination.ts'
import { BadRequestError } from '../supabase/functions/_shared/http.ts'

const url = (query: string) => new Request(`https://example.test/fn${query}`)

Deno.test('normalizePage falls back for anything that is not a page number', () => {
  assertEquals(normalizePage(3), 3)
  assertEquals(normalizePage('4'), 4)
  assertEquals(normalizePage(undefined), 1)
  assertEquals(normalizePage('not-a-number'), 1)
  assertEquals(normalizePage(0), 1)
  assertEquals(normalizePage(-7), 1)
  assertEquals(normalizePage(2.9), 2, 'truncates rather than rounds')
})

Deno.test('normalizePageSize clamps to the maximum instead of rejecting', () => {
  assertEquals(normalizePageSize(25), 25)
  assertEquals(normalizePageSize(undefined), 20)
  assertEquals(normalizePageSize(0), 20)
  assertEquals(normalizePageSize(5000), 100)
  assertEquals(normalizePageSize(5000, 20, 50), 50)
})

Deno.test('parsePaginationQuery accepts the aliases the app actually sends', () => {
  assertEquals(parsePaginationQuery({ page: '2', pageSize: '30' }), { page: 2, pageSize: 30 })
  assertEquals(parsePaginationQuery({ pageNumber: '3', limit: '10' }), { page: 3, pageSize: 10 })
})

Deno.test('getPaginationRange turns a page into a zero-based offset', () => {
  assertEquals(getPaginationRange(1, 20), { page: 1, pageSize: 20, offset: 0, limit: 20 })
  assertEquals(getPaginationRange(3, 20), { page: 3, pageSize: 20, offset: 40, limit: 20 })
})

Deno.test('rangeFromRequest produces an inclusive PostgREST range', () => {
  assertEquals(rangeFromRequest(url('?page=2&pageSize=10')), {
    page: 2,
    pageSize: 10,
    from: 10,
    to: 19,
  })
})

Deno.test('rangeFromRequest defaults are applied per endpoint', () => {
  assertEquals(rangeFromRequest(url(''), { defaultPageSize: 50 }).pageSize, 50)
})

Deno.test('a page past MAX_OFFSET is rejected, not silently clamped', () => {
  const error = assertThrows(
    () => rangeFromRequest(url('?page=100000&pageSize=100')),
    BadRequestError,
  )
  assertEquals(error.code, 'PAGE_OUT_OF_RANGE')
})

Deno.test('the last page inside the ceiling is still served', () => {
  const { from } = rangeFromRequest(url(`?page=${MAX_OFFSET / 100 + 1}&pageSize=100`))
  assertEquals(from, MAX_OFFSET)
  assertOffsetInRange(from)
})

Deno.test('assertOffsetInRange honours a per-endpoint ceiling', () => {
  assertOffsetInRange(500, 1000)
  assertThrows(() => assertOffsetInRange(1001, 1000), BadRequestError)
})

Deno.test('paginate reports totals when the count is known', () => {
  const result = paginate([1, 2, 3], 45, 2, 20)

  assertEquals(result.page, 2)
  assertEquals(result.pageSize, 20)
  assertEquals(result.totalCount, 45)
  assertEquals(result.totalPages, 3)
  assertEquals(result.hasNextPage, true)
  assertEquals(result.hasPreviousPage, true)
})

Deno.test('paginate infers hasNextPage from a full page when the count is unknown', () => {
  const full = paginate(new Array(20).fill(0), null, 1, 20)
  assertEquals(full.hasNextPage, true)
  assertEquals(full.totalPages, null)

  const partial = paginate(new Array(3).fill(0), null, 1, 20)
  assertEquals(partial.hasNextPage, false)
})

Deno.test('paginate reports the empty final page as having no next page', () => {
  const result = paginate([], 40, 3, 20)
  assertEquals(result.hasNextPage, false)
  assertEquals(result.hasPreviousPage, true)
  assertEquals(result.totalPages, 2)
})

Deno.test('buildCursorPagination trims to the page size and exposes both cursors', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const result = buildCursorPagination(items, (item) => item.id, 2)

  assertEquals(result.data.length, 2)
  assertEquals(result.nextCursor, 'b')
  assertEquals(result.previousCursor, 'a')
  assertEquals(result.hasNextPage, true)
})
