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

// CORS for Edge Functions.
//
// v1 decision: `Access-Control-Allow-Origin: *` is intentional. The product
// client is React Native (no browser origin), and admin CMS today is Edge
// Function + service tooling, not a browser SPA. When a browser admin web
// app ships, replace `*` with an allow-list from env (e.g. ALLOWED_ORIGINS)
// and keep OPTIONS + the same method/header lists.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(
  payload: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  options: { cors?: boolean } = {},
): Response {
  const useCors = options.cors !== false
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...(useCors ? corsHeaders : {}),
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      ...extraHeaders,
    },
  })
}

export function ok(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  options: { cors?: boolean } = {},
): Response {
  return json({ data }, status, extraHeaders, options)
}

// Cache-Control for a response the whole audience shares.
//
// Only for genuinely public, non-personalised payloads - the catalogue, the
// carousel, the weekly draw - which are the same bytes for every caller until
// an admin edits them. Never for anything read with a user JWT.
//
// This matters more than it looks: json() defaults every response to
// `private, no-store`, which is right for user data but tells the CDN and the
// phone's own HTTP cache to throw the catalogue away on every screen. A public
// endpoint that forgets this helper is silently uncacheable.
//
// `stale-while-revalidate` is what keeps a cache expiry from turning into a
// thundering herd on the database.
export const CATALOGUE_CACHE_SECONDS = 60
export const REFERENCE_CACHE_SECONDS = 300
export function publicCache(maxAgeSeconds: number): Record<string, string> {
  const swr = Math.max(60, Math.floor(maxAgeSeconds / 2))
  return {
    'Cache-Control':
      `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${swr}`,
  }
}

export function fail(
  code: string,
  message: string,
  status: number,
  options: { cors?: boolean } = {},
): Response {
  return json({ error: { code, message } }, status, {}, options)
}

// Paginated list response. The envelope already carries `data`, so it is
// serialised as-is rather than nested under another `data` key.
// Extra keys (e.g. collection meta on collection-books) are allowed.
export function list(
  envelope: { data: unknown[] } & Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return json(envelope, 200, extraHeaders)
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
  options: { cors?: boolean } = {},
): Response {
  console.error(`[${scope}]`, error?.code ?? '', error?.message ?? error)
  return fail(code, message, status, options)
}

// Single catch-all so an unexpected throw never leaks a stack or a raw driver
// message to the app.
export function failUnexpected(
  scope: string,
  error: unknown,
  options: { cors?: boolean } = {},
): Response {
  console.error(`[${scope}] unexpected`, error)
  return fail('UNEXPECTED_ERROR', 'Something went wrong. Please try again.', 500, options)
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
export function handleError(
  scope: string,
  error: unknown,
  options: { cors?: boolean } = {},
): Response {
  if (error instanceof BadRequestError) {
    return fail(error.code, error.message, 400, options)
  }

  return failUnexpected(scope, error, options)
}

export async function readJsonBody(
  req: Request,
  options: { maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? 256 * 1024
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new BadRequestError('Request body too large', 'PAYLOAD_TOO_LARGE')
    }
  }

  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new BadRequestError('Request body too large', 'PAYLOAD_TOO_LARGE')
  }

  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

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
