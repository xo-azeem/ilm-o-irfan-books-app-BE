/**
 * Reset password for a hosted Auth user (service role), then verify login.
 *
 * Usage:
 *   node scripts/reset-hosted-user-password.mjs admin@gmail.com 'YourNewPass!'
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

const email = process.argv[2]
const password = process.argv[3]
if (!email || !password) {
  console.error('Usage: node scripts/reset-hosted-user-password.mjs <email> <password>')
  process.exit(1)
}

const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const anon = (process.env.SUPABASE_ANON_KEY ?? '').trim()
if (!base || !service || !anon) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY required')
  process.exit(1)
}

const listRes = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=50`, {
  headers: { apikey: service, Authorization: `Bearer ${service}` },
})
const list = await listRes.json()
if (!listRes.ok) {
  console.error('list users failed', listRes.status, list)
  process.exit(1)
}

const user = (list.users ?? []).find(
  (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
)
if (!user) {
  console.error('USER_NOT_FOUND', email)
  process.exit(1)
}

const patchRes = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
  method: 'PUT',
  headers: {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    password,
    email_confirm: true,
    app_metadata: {
      ...(user.app_metadata ?? {}),
      // keep existing app_role if present
    },
  }),
})
const patched = await patchRes.json()
if (!patchRes.ok) {
  console.error('RESET_FAIL', patchRes.status, patched)
  process.exit(1)
}
console.log('PASSWORD_RESET_OK', email)

const loginRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const login = await loginRes.json()
if (!loginRes.ok) {
  console.error('LOGIN_FAIL', loginRes.status, login)
  process.exit(1)
}
console.log('LOGIN_OK', {
  email,
  app_role: login.user?.app_metadata?.app_role ?? null,
})

const statusRes = await fetch(`${base}/functions/v1/entitlements-status`, {
  headers: { apikey: anon, Authorization: `Bearer ${login.access_token}` },
})
const status = await statusRes.json()
console.log('entitlements-status', statusRes.status, JSON.stringify(status.data ?? status))

const isAdminEmail = email.toLowerCase().startsWith('admin')
if (
  isAdminEmail &&
  !(status?.data?.isAdmin === true && status?.data?.canAccessPremium === true)
) {
  console.error('ADMIN_CHECK_FAILED')
  process.exit(1)
}
console.log('VERIFY_OK')
