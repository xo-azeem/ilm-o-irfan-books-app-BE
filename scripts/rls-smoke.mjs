/**
 * Hosted RLS / paywall regression checks (anon + optional user/admin JWTs).
 *
 * Required: SUPABASE_URL, SUPABASE_ANON_KEY
 * Optional: SUPABASE_USER_JWT (non-admin, ideally without entitlement)
 * Optional: SUPABASE_ADMIN_JWT (expects isAdmin + canAccessPremium)
 *
 * Does not use the service role. Safe against staging.
 *
 * Usage: npm run smoke:rls
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
const rest = `${base}/rest/v1`
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

async function restFetch(path, { method = 'GET', token = anon, body, prefer } = {}) {
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${rest}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

async function ef(name, { method = 'GET', token = anon, body, query = '' } = {}) {
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${token}`,
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

console.log(`== RLS smoke against ${base} ==`)

{
  const { status, json } = await restFetch(
    '/books?select=id&is_published=eq.false&limit=5',
  )
  const rows = Array.isArray(json) ? json : []
  if (status === 200 && rows.length === 0) {
    pass('anon cannot list unpublished books')
  } else {
    fail('anon unpublished books leak', `status=${status} rows=${rows.length}`)
  }
}

{
  const { status } = await restFetch('/entitlements', {
    method: 'POST',
    body: {
      user_id: '00000000-0000-0000-0000-000000000001',
      plan_id: '00000000-0000-0000-0000-000000000001',
      status: 'active',
    },
    prefer: 'return=minimal',
  })
  if (status >= 400) {
    pass(`anon cannot INSERT entitlements (HTTP ${status})`)
  } else {
    fail('anon INSERT entitlements unexpectedly allowed', `status=${status}`)
  }
}

{
  const { status } = await ef('signed-pdf', { method: 'POST', body: {} })
  if (status === 410) {
    pass('signed-pdf returns 410')
  } else {
    fail('signed-pdf should be 410', `status=${status}`)
  }
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
  const { status, json } = await ef('home-feed')
  if (status === 200 && Object.hasOwn(json?.data ?? {}, 'supportEmail')) {
    pass('home-feed includes supportEmail')
  } else {
    fail('home-feed missing supportEmail', `status=${status}`)
  }
}

if (userJwt) {
  {
    const { status, json } = await restFetch(
      '/profiles?id=eq.00000000-0000-0000-0000-000000000099',
      {
        method: 'PATCH',
        token: userJwt,
        body: { role: 'admin' },
        prefer: 'return=representation',
      },
    )
    const rows = Array.isArray(json) ? json : []
    if ((status === 200 && rows.length === 0) || status >= 400) {
      pass(`user cannot escalate role (HTTP ${status})`)
    } else {
      fail('user may have updated role', `status=${status}`)
    }
  }

  {
    const { status } = await ef('admin-books', { token: userJwt })
    if (status === 403 || status === 401) {
      pass(`non-admin denied admin-books (${status})`)
    } else {
      fail('non-admin reached admin-books', `status=${status}`)
    }
  }

  {
    const list = await ef('books-list', { query: '?page=1&pageSize=20' })
    const books = Array.isArray(list.json?.data) ? list.json.data : []
    const premium = books.find((b) => b.is_premium === true)
    if (!premium) {
      console.log('== PREMIUM_REQUIRED skipped (no published premium book) ==')
    } else {
      const { status, json } = await ef('get-signed-pdf', {
        method: 'POST',
        token: userJwt,
        body: { bookId: premium.id },
      })
      const code = json?.error?.code
      if (status === 403 && code === 'PREMIUM_REQUIRED') {
        pass('non-entitled user gets PREMIUM_REQUIRED')
      } else if (status === 200) {
        fail('non-entitled user received a signed PDF', `book=${premium.id}`)
      } else {
        fail('unexpected get-signed-pdf for premium', `status=${status} code=${code}`)
      }
    }
  }
} else {
  console.log('== user JWT checks skipped (set SUPABASE_USER_JWT) ==')
}

if (adminJwt) {
  const { status, json } = await ef('entitlements-status', { token: adminJwt })
  if (
    status === 200 &&
    json?.data?.isAdmin === true &&
    json?.data?.canAccessPremium === true
  ) {
    pass('admin entitlements-status isAdmin + canAccessPremium')
  } else {
    fail('admin entitlements-status mismatch', JSON.stringify(json))
  }
} else {
  console.log('== admin JWT checks skipped (set SUPABASE_ADMIN_JWT) ==')
}

if (failed > 0) {
  console.error(`\n${failed} RLS check(s) failed.`)
  process.exit(1)
}

console.log('\nAll RLS smoke checks passed.')
