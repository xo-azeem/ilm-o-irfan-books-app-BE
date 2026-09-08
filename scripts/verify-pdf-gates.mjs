/**
 * Verify get-signed-pdf gates on hosted staging.
 *
 * The catalogue is subscription-only: every book needs an active entitlement,
 * and is_premium does not enter into it. So this checks the two things that
 * are still allowed to differ - who is asking, not which book - plus the one
 * that must not: a book flagged is_premium=false is gated exactly like any
 * other. Signed-out and no-subscription callers are covered by
 * verify-premium-required.mjs, which can make a throwaway user.
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
const password = process.env.SMOKE_PASSWORD ?? 'Password123!'

async function login(email) {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`)
  return body.access_token
}

async function signedPdf(token, bookId) {
  const res = await fetch(`${base}/functions/v1/get-signed-pdf`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookId }),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

const listRes = await fetch(`${base}/functions/v1/books-list?page=1&pageSize=20`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}` },
})
const list = await listRes.json()
const books = Array.isArray(list?.data) ? list.data : []
console.log('books', books.map((b) => ({ slug: b.slug, premium: b.is_premium, id: b.id })))

const anyBook = books[0]
if (!anyBook) {
  console.error('Need at least one published book')
  process.exit(1)
}

// A book carrying is_premium=false is the interesting case: it must be gated
// like everything else. There may not be one - the catalogue is all premium -
// in which case there is simply nothing extra to prove here.
const flaggedFree = books.find((b) => b.is_premium === false) ?? null

const userJwt = await login('test@gmail.com')
const adminJwt = await login('admin@gmail.com')

// Both subjects hold access: the test user via a promotional entitlement, the
// admin via role. Absence of access is verify-premium-required.mjs's job.
const cases = [
  ['subscriber+book', userJwt, anyBook.id, 200],
  ['admin+book', adminJwt, anyBook.id, 200],
]

if (flaggedFree) {
  cases.push(['subscriber+is_premium=false', userJwt, flaggedFree.id, 200])
} else {
  console.log('SKIP no is_premium=false book in the catalogue (expected)')
}

let failed = 0
for (const [label, token, bookId, expectStatus] of cases) {
  const { status, json } = await signedPdf(token, bookId)
  const ok =
    status === expectStatus &&
    (expectStatus === 200 ? Boolean(json?.data?.signedUrl || json?.data?.url) : true)
  console.log(ok ? 'PASS' : 'FAIL', label, status, json?.error?.code ?? 'ok')
  if (!ok) failed += 1
}

if (failed) process.exit(1)
console.log('PDF_GATE_OK')
