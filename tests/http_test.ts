import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'

import {
  BadRequestError,
  corsHeaders,
  ERROR_CODES,
  fail,
  failUnexpected,
  handleError,
  handleOptions,
  list,
  ok,
  readJsonBody,
} from '../supabase/functions/_shared/http.ts'
import { requireMethod } from '../supabase/functions/_shared/auth.ts'

const post = (body: unknown, contentType = 'application/json') =>
  new Request('https://example.test/fn', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

Deno.test('ok wraps a single record under data', async () => {
  const response = ok({ id: 1 })
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { data: { id: 1 } })
})

Deno.test('list keeps the pagination envelope at the top level', async () => {
  const response = list({ data: [1, 2], page: 1, pageSize: 20 } as never)
  assertEquals(await response.json(), { data: [1, 2], page: 1, pageSize: 20 })
})

Deno.test('fail uses the code/message envelope the app branches on', async () => {
  const response = fail(ERROR_CODES.NOT_FOUND, 'Book not found', 404)
  assertEquals(response.status, 404)
  assertEquals(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'Book not found' },
  })
})

Deno.test('every response carries the CORS headers the app needs', () => {
  const response = ok({})
  for (const [key, value] of Object.entries(corsHeaders)) {
    assertEquals(response.headers.get(key), value)
  }
  assertEquals(response.headers.get('Content-Type'), 'application/json')
})

Deno.test('v1 CORS stays wide-open for React Native (tighten when admin web ships)', () => {
  assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*')
})

Deno.test('handleOptions answers preflight and passes everything else through', () => {
  const preflight = handleOptions(new Request('https://example.test/fn', { method: 'OPTIONS' }))
  assertEquals(preflight?.status, 200)
  assertEquals(handleOptions(new Request('https://example.test/fn')), null)
})

Deno.test('requireMethod names the methods it does allow', async () => {
  assertEquals(requireMethod(post({}), ['POST']), null)

  const response = requireMethod(new Request('https://example.test/fn'), ['POST'])!
  assertEquals(response.status, 405)

  const body = await response.json()
  assertEquals(body.error.code, 'METHOD_NOT_ALLOWED')
  assertStringIncludes(body.error.message, 'POST')
})

Deno.test('handleError turns bad input into a 400 with its own code', async () => {
  const response = handleError('scope', new BadRequestError('bad id', 'INVALID_REQUEST'))
  assertEquals(response.status, 400)
  assertEquals(await response.json(), {
    error: { code: 'INVALID_REQUEST', message: 'bad id' },
  })
})

Deno.test('handleError never leaks an unexpected throw to the caller', async () => {
  const response = handleError('scope', new Error('connect ECONNREFUSED 10.0.0.1:5432'))
  assertEquals(response.status, 500)

  const body = await response.json()
  assertEquals(body.error.code, 'UNEXPECTED_ERROR')
  assertEquals(body.error.message, 'Something went wrong. Please try again.')
})

Deno.test('failUnexpected keeps the same contract as handleError', async () => {
  const body = await failUnexpected('scope', new Error('boom')).json()
  assertEquals(body.error.code, 'UNEXPECTED_ERROR')
})

Deno.test('readJsonBody returns an empty object rather than throwing on junk', async () => {
  assertEquals(await readJsonBody(post({ a: 1 })), { a: 1 })
  assertEquals(await readJsonBody(post('not json')), {})
  assertEquals(await readJsonBody(post([1, 2])), {}, 'a top-level array is not a payload')
  assertEquals(await readJsonBody(post('null')), {})
})
