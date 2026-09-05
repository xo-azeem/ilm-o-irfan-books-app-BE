import { assertEquals } from 'jsr:@std/assert@1'

import { failFromRpcError } from '../supabase/functions/_shared/rpc.ts'

const read = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as { error: { code: string; message: string } },
})

const map = (error: { code?: string; message?: string } | null) =>
  read(failFromRpcError('scope', 'FALLBACK_CODE', 'Fallback message', error))

Deno.test('an admin guard becomes a 403, whichever way the RPC raised it', async () => {
  assertEquals((await map({ code: '42501', message: 'not allowed' })).status, 403)
  assertEquals((await map({ code: 'P0001', message: 'not allowed' })).status, 403)

  const { body } = await map({ code: '42501', message: 'permission denied for table books' })
  assertEquals(body.error.code, 'FORBIDDEN')
  assertEquals(body.error.message, 'Admin access is required', 'never echoes the raw text')
})

Deno.test('a missing row becomes a 404 carrying the RPC message', async () => {
  const { status, body } = await map({ code: 'P0002', message: 'category not found' })
  assertEquals(status, 404)
  assertEquals(body.error.code, 'NOT_FOUND')
  assertEquals(body.error.message, 'category not found')
})

Deno.test('rejected input becomes a 400 that names the rule', async () => {
  const { status, body } = await map({
    code: '22023',
    message: 'kind must be hero, shelf or carousel',
  })
  assertEquals(status, 400)
  assertEquals(body.error.code, 'INVALID_REQUEST')
  assertEquals(body.error.message, 'kind must be hero, shelf or carousel')
})

Deno.test('a delete guard becomes a 409, not a 500', async () => {
  const { status, body } = await map({ code: '23503', message: 'category still has 4 book(s)' })
  assertEquals(status, 409)
  assertEquals(body.error.code, 'CONFLICT')
  assertEquals(body.error.message, 'category still has 4 book(s)')
})

Deno.test('a duplicate slug or code is a 400 with a stable message', async () => {
  const { status, body } = await map({
    code: '23505',
    message: 'duplicate key value violates unique constraint "categories_slug_unique"',
  })
  assertEquals(status, 400)
  assertEquals(body.error.code, 'INVALID_REQUEST')
  assertEquals(
    body.error.message,
    'A row with this slug or code already exists',
    'the constraint name stays in the log, not in the response',
  )
})

// The point of the mapper: anything it does not recognise must not leak driver
// text to the app, and must not be reported as the caller's fault.
Deno.test('an unrecognised failure is a logged 500 with a generic message', async () => {
  const { status, body } = await map({
    code: '08006',
    message: 'connection failure: could not connect to 10.0.0.1:5432',
  })
  assertEquals(status, 500)
  assertEquals(body.error.code, 'FALLBACK_CODE')
  assertEquals(body.error.message, 'Fallback message')
})

Deno.test('a P0001 that is not the admin guard is not turned into a 403', async () => {
  assertEquals((await map({ code: 'P0001', message: 'something else broke' })).status, 500)
})

Deno.test('a null error still produces a valid envelope', async () => {
  const { status, body } = await map(null)
  assertEquals(status, 500)
  assertEquals(body.error.code, 'FALLBACK_CODE')
})
