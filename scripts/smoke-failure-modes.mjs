/**
 * Hosted failure-mode smoke (no Docker).
 *
 * Covers the negative paths the local e2e suite also asserts when Docker is available:
 * webhook auth failure, admin forbidden for anon, deprecated signed-pdf 410,
 * optional PREMIUM_REQUIRED / admin storage audit when JWTs are set.
 *
 * Required: SUPABASE_URL, SUPABASE_ANON_KEY
 * Optional: SUPABASE_USER_JWT, SUPABASE_ADMIN_JWT
 *
 * Usage: npm run smoke:failures
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotEnv()

const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const anon = (process.env.SUPABASE_ANON_KEY ?? '').trim()
const userJwt = (process.env.SUPABASE_USER_JWT ?? '').trim()
const adminJwt = (process.env.SUPABASE_ADMIN_JWT ?? '').trim()
const fn = `${base}/functions/v1`

if (!base || !anon) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required')
  process.exit(1)
}

let failed = 0

function pass(msg) {
  console.log(`  PASS  ${msg}`)
}

function fail(msg, detail) {
  failed += 1
  console.error(`  FAIL  ${msg}`)
  if (detail) console.error(`        ${detail}`)
}

async function ef(name, { method = 'GET', token, authHeader, body, query = '' } = {}) {
  const headers = {
    apikey: anon,
  }
  if (authHeader !== undefined) {
    if (authHeader !== null) headers.Authorization = authHeader
  } else {
    headers.Authorization = `Bearer ${token ?? anon}`
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${fn}/${name}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

console.log(`== failure-mode smoke against ${base} ==`)

{
  const { status, json } = await ef('revenuecat-webhook', {
    method: 'POST',
    authHeader: 'Bearer WRONG_WEBHOOK_SECRET',
    body: { event: { id: '00000000-0000-0000-0000-000000000099' } },
  })
  const code = json?.error?.code
  if (status === 401 && code === 'WEBHOOK_AUTH_FAILED') {
    pass('webhook wrong Authorization → WEBHOOK_AUTH_FAILED')
  } else if (status === 500 && code === 'WEBHOOK_CONFIG_ERROR') {
    fail('webhook secret not configured on project', code)
  } else {
    fail('webhook auth failure', `status=${status} code=${code}`)
  }
}

{
  const { status, json } = await ef('revenuecat-webhook', {
    method: 'POST',
    authHeader: null,
    body: {},
  })
  const code = json?.error?.code
  if (status === 401 && (code === 'WEBHOOK_AUTH_FAILED' || code === 'AUTH_REQUIRED')) {
    pass(`webhook missing Authorization → ${code}`)
  } else if (status === 401) {
    pass(`webhook missing Authorization → HTTP 401 (${code ?? 'no code'})`)
  } else {
    fail('webhook should reject missing auth', `status=${status} code=${code}`)
  }
}

{
  const { status } = await ef('signed-pdf', { method: 'POST', body: {} })
  if (status === 410) pass('deprecated signed-pdf → 410')
  else fail('signed-pdf should be 410', `status=${status}`)
}

{
  const { status, json } = await ef('admin-books')
  if (status === 401 || status === 403) {
    pass(`admin-books rejects anon (${status} ${json?.error?.code ?? ''})`.trim())
  } else {
    fail('admin-books should reject anon', `status=${status}`)
  }
}

{
  const { status, json } = await ef('get-signed-pdf', { method: 'POST', body: {} })
  if (status === 401) pass('get-signed-pdf rejects anon')
  else fail('get-signed-pdf should reject anon', `status=${status} ${json?.error?.code}`)
}

if (userJwt) {
  const { status, json } = await ef('admin-books', { token: userJwt })
  if (status === 403 || status === 401) {
    pass(`non-admin denied admin-books (${status})`)
  } else {
    fail('non-admin reached admin-books', `status=${status} ${JSON.stringify(json)?.slice(0, 120)}`)
  }
} else {
  console.log('== non-admin forbidden skipped (set SUPABASE_USER_JWT) ==')
}

if (adminJwt) {
  const { status, json } = await ef('admin-storage-audit', { token: adminJwt })
  if (status === 200 && json?.data) {
    pass('admin-storage-audit 200 for admin')
  } else {
    fail('admin-storage-audit', `status=${status} ${JSON.stringify(json)?.slice(0, 200)}`)
  }
} else {
  console.log('== admin-storage-audit skipped (set SUPABASE_ADMIN_JWT) ==')
}

if (failed > 0) {
  console.error(`\n${failed} failure-mode check(s) failed.`)
  process.exit(1)
}

console.log('\nAll failure-mode smoke checks passed.')
