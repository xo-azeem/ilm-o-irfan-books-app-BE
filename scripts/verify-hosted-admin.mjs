/**
 * Sign in as seed admin/test and verify entitlements-status.
 * Password from supabase/seed.sql (Password123!).
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
const email = process.argv[2] ?? 'admin@gmail.com'
const password = process.argv[3] ?? 'Password123!'

if (!base || !anon) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY required')
  process.exit(1)
}

const loginRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: {
    apikey: anon,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password }),
})
const login = await loginRes.json()
if (!loginRes.ok) {
  console.error('LOGIN_FAIL', loginRes.status, login)
  process.exit(1)
}

const jwt = login.access_token
console.log('LOGIN_OK', email)
console.log('app_role', login.user?.app_metadata?.app_role ?? null)

const statusRes = await fetch(`${base}/functions/v1/entitlements-status`, {
  headers: {
    apikey: anon,
    Authorization: `Bearer ${jwt}`,
  },
})
const status = await statusRes.json()
console.log('entitlements-status', statusRes.status, JSON.stringify(status, null, 2))

if (
  email.startsWith('admin') &&
  !(status?.data?.isAdmin === true && status?.data?.canAccessPremium === true)
) {
  console.error('ADMIN_CHECK_FAILED')
  process.exit(1)
}

console.log('ADMIN_VERIFY_OK')
// Print JWT only if VERIFY_PRINT_JWT=1 (for local smoke env) — default off
if (process.env.VERIFY_PRINT_JWT === '1') {
  console.log('JWT', jwt)
}
