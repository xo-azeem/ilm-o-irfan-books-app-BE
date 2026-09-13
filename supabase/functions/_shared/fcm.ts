// FCM HTTP v1, without a Firebase Admin SDK.
//
// The Admin SDK is Node-shaped and heavy for an isolate that sends a few dozen
// requests a minute. The v1 API needs only two things: an OAuth 2.0 access
// token minted from the service account's key, and one POST per message. Both
// are a handful of lines on WebCrypto and fetch, so that is all this is.
//
// The service account comes from FCM_SERVICE_ACCOUNT_B64 (the JSON key file,
// base64-encoded so it survives `supabase secrets set --env-file`) or, for
// local runs, FCM_SERVICE_ACCOUNT_JSON as-is. Neither is ever logged.

export type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

export type FcmMessage = {
  token?: string
  topic?: string
  notification: { title: string; body: string }
  data: Record<string, string>
  android?: {
    priority?: 'normal' | 'high'
    collapse_key?: string
    notification?: {
      channel_id?: string
      tag?: string
      sound?: string
      icon?: string
      color?: string
    }
  }
  apns?: {
    headers?: Record<string, string>
    payload?: { aps: Record<string, unknown> }
  }
}

export type SendOutcome =
  | { ok: true; name: string }
  | {
      ok: false
      status: number
      code: string
      // FCM said "try again later" (429, 5xx, UNAVAILABLE, INTERNAL).
      retryable: boolean
      // FCM said this registration token is dead; stop sending to it.
      tokenInvalid: boolean
    }

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'

export function loadServiceAccount(): ServiceAccount | null {
  const b64 = Deno.env.get('FCM_SERVICE_ACCOUNT_B64')?.trim()
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')?.trim()

  let text: string | null = null
  try {
    if (b64) {
      text = new TextDecoder().decode(base64Decode(b64))
    } else if (raw) {
      text = raw
    }
  } catch {
    return null
  }

  if (!text) return null

  try {
    const parsed = JSON.parse(text) as Partial<ServiceAccount>
    if (
      typeof parsed.project_id !== 'string' ||
      typeof parsed.client_email !== 'string' ||
      typeof parsed.private_key !== 'string'
    ) {
      return null
    }
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      token_uri: typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// OAuth token, cached for the life of the isolate
// ---------------------------------------------------------------------------

let cached: { token: string; expiresAt: number; email: string } | null = null
let keyCache: { pem: string; key: CryptoKey } | null = null

async function signingKey(pem: string): Promise<CryptoKey> {
  if (keyCache && keyCache.pem === pem) return keyCache.key

  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')

  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64Decode(body),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  keyCache = { pem, key }
  return key
}

export async function accessToken(sa: ServiceAccount, force = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (!force && cached && cached.email === sa.client_email && cached.expiresAt - 60 > now) {
    return cached.token
  }

  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: SCOPE,
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
  const unsigned = `${header}.${claims}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await signingKey(sa.private_key),
    new TextEncoder().encode(unsigned),
  )
  const assertion = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`FCM OAuth token request failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error('FCM OAuth token response had no access_token')
  }

  cached = {
    token: json.access_token,
    expiresAt: now + (typeof json.expires_in === 'number' ? json.expires_in : 3600),
    email: sa.client_email,
  }
  return cached.token
}

// ---------------------------------------------------------------------------
// One send
// ---------------------------------------------------------------------------

const RETRYABLE_STATUSES = new Set(['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED'])

export async function sendMessage(sa: ServiceAccount, message: FcmMessage): Promise<SendOutcome> {
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`

  let attempt = 0
  while (true) {
    attempt += 1
    const token = await accessToken(sa, attempt > 1)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      })
    } catch (error) {
      return {
        ok: false,
        status: 0,
        code: `NETWORK:${(error as Error)?.message ?? 'fetch failed'}`.slice(0, 120),
        retryable: true,
        tokenInvalid: false,
      }
    }

    if (response.ok) {
      const json = (await response.json().catch(() => ({}))) as { name?: string }
      return { ok: true, name: json.name ?? '' }
    }

    // A stale OAuth token gets one refresh. Anything else is reported as-is.
    if (response.status === 401 && attempt === 1) {
      await response.text().catch(() => '')
      continue
    }

    const body = (await response.json().catch(() => null)) as
      | {
          error?: {
            status?: string
            message?: string
            details?: Array<{ '@type'?: string; errorCode?: string }>
          }
        }
      | null

    const status = body?.error?.status ?? `HTTP_${response.status}`
    const fcmCode = body?.error?.details?.find((d) => typeof d.errorCode === 'string')?.errorCode
    const code = fcmCode ? `${status}:${fcmCode}` : status

    const tokenInvalid =
      Boolean(message.token) &&
      (status === 'NOT_FOUND' ||
        fcmCode === 'UNREGISTERED' ||
        fcmCode === 'SENDER_ID_MISMATCH' ||
        (status === 'INVALID_ARGUMENT' && /registration token|token/i.test(body?.error?.message ?? '')))

    const retryable =
      !tokenInvalid &&
      (response.status === 429 || response.status >= 500 || RETRYABLE_STATUSES.has(status))

    return { ok: false, status: response.status, code, retryable, tokenInvalid }
  }
}

// ---------------------------------------------------------------------------
// base64 helpers (Deno has atob/btoa; these handle bytes and the url alphabet)
// ---------------------------------------------------------------------------

// Return type inferred: on TS 5.7+ that is Uint8Array<ArrayBuffer>, which is
// what WebCrypto wants; an explicit Uint8Array annotation would widen it.
function base64Decode(input: string) {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
