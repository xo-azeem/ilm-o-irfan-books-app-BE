/**
 * Create a throwaway user with no entitlement and assert PREMIUM_REQUIRED.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

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
const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const email = `gate-${randomBytes(4).toString('hex')}@example.com`
const password = 'Password123!'

const create = await fetch(`${base}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
})
const created = await create.json()
if (!create.ok) {
  console.error('create user failed', create.status, created)
  process.exit(1)
}

const login = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const tok = await login.json()
if (!login.ok) {
  console.error('login failed', tok)
  process.exit(1)
}

const booksRes = await fetch(`${base}/functions/v1/books-list?page=1&pageSize=50`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}` },
})
const booksJson = await booksRes.json()
// Any published book will do. The catalogue is subscription-only, so the gate
// no longer reads is_premium - picking a book by that flag would test the flag
// rather than the gate. Preferring an is_premium=false one when it exists makes
// this the stronger check: the book that used to be free must now be refused.
const candidates = booksJson.data ?? []
const target = candidates.find((b) => b.is_premium === false) ?? candidates[0]
if (!target) {
  console.error('no published book')
  process.exit(1)
}

const pdf = await fetch(`${base}/functions/v1/get-signed-pdf`, {
  method: 'POST',
  headers: {
    apikey: anon,
    Authorization: `Bearer ${tok.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ bookId: target.id }),
})
const body = await pdf.json()
console.log({ email, status: pdf.status, code: body?.error?.code })

// cleanup
await fetch(`${base}/auth/v1/admin/users/${created.id}`, {
  method: 'DELETE',
  headers: { apikey: service, Authorization: `Bearer ${service}` },
})

if (pdf.status === 403 && body?.error?.code === 'PREMIUM_REQUIRED') {
  console.log('PREMIUM_REQUIRED_OK')
  process.exit(0)
}
console.error('unexpected', body)
process.exit(1)
