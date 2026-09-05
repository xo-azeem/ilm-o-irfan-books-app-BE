// Shared response helpers.
//
// Every endpoint returns one of two shapes, so the app can have a single
// parser and a single error handler:
//
//   success (single)  { "data": { ... } }
//   success (list)    { "data": [ ... ], "page": 1, "pageSize": 20, ... }
//   failure           { "error": { "code": "AUTH_REQUIRED", "message": "..." } }
//
// `code` is the stable value to branch on. `message` is for logs and
// developer-facing surfaces; it is never a raw Postgres error.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function ok(data: unknown, status = 200): Response {
  return json({ data }, status)
}

export function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

// Paginated list response. The envelope already carries `data`, so it is
// serialised as-is rather than nested under another `data` key.
// Extra keys (e.g. collection meta on collection-books) are allowed.
export function list(envelope: { data: unknown[] } & Record<string, unknown>): Response {
  return json(envelope)
}

// Preflight. Returns null when the request is not an OPTIONS probe.
export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

// Postgres error text can name columns, constraints and policies. Log it, but
// hand the client a stable code and a message that is safe to display.
export function failFromDbError(
  scope: string,
  code: string,
  message: string,
  error: { message?: string; code?: string } | null,
  status = 500,
): Response {
  console.error(`[${scope}]`, error?.code ?? '', error?.message ?? error)
  return fail(code, message, status)
}

// Single catch-all so an unexpected throw never leaks a stack or a raw driver
// message to the app.
export function failUnexpected(scope: string, error: unknown): Response {
  console.error(`[${scope}] unexpected`, error)
  return fail('UNEXPECTED_ERROR', 'Something went wrong. Please try again.', 500)
}

// Thrown by validators so a handler can turn bad input into a 400 rather than
// letting it fall through to the 500 catch-all.
export class BadRequestError extends Error {
  code: string

  constructor(message: string, code = 'INVALID_REQUEST') {
    super(message)
    this.name = 'BadRequestError'
    this.code = code
  }
}

// The tail of every handler. Bad input is the caller's fault (400); anything
// else is ours (500, logged, nothing leaked). Written once so a handler cannot
// forget the BadRequestError branch and turn a typo into a 500.
export function handleError(scope: string, error: unknown): Response {
  if (error instanceof BadRequestError) {
    return fail(error.code, error.message, 400)
  }

  return failUnexpected(scope, error)
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {}
  }

  return body as Record<string, unknown>
}

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_REQUEST: 'INVALID_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAGE_OUT_OF_RANGE: 'PAGE_OUT_OF_RANGE',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const
