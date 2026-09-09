/**
 * Hosted smoke checks for public Edge Functions (no Docker).
 *
 * Required:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *
 * Optional:
 *   SUPABASE_USER_JWT   if set, also hits entitlements-status + profile-read
 *   SMOKE_COLLECTION_SLUG  default home-hero (from seed)
 *
 * Usage:
 *   npm run smoke:hosted
 *   node scripts/smoke-hosted.mjs --help
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))

function printHelp() {
  console.log(`smoke-hosted — curl public (and optional user) Edge Functions

Required:
  SUPABASE_URL
  SUPABASE_ANON_KEY

Optional:
  SUPABASE_USER_JWT          Bearer token for authenticated routes
  SMOKE_COLLECTION_SLUG      default "home-hero"
`)
}

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

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

loadDotEnv()

const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const anon = (process.env.SUPABASE_ANON_KEY ?? '').trim()
const userJwt = (process.env.SUPABASE_USER_JWT ?? '').trim()
const collectionSlug = (process.env.SMOKE_COLLECTION_SLUG ?? 'home-hero').trim()

if (!base) {
  console.error('ERROR: SUPABASE_URL is required')
  process.exit(1)
}
if (!anon) {
  console.error('ERROR: SUPABASE_ANON_KEY is required')
  process.exit(1)
}

let failed = 0

function ok(msg) {
  console.log(`  PASS  ${msg}`)
}

function no(msg, detail) {
  failed += 1
  console.error(`  FAIL  ${msg}`)
  if (detail) console.error(`        ${detail}`)
}

async function invoke(name, { method = 'GET', path = '', body, auth } = {}) {
  const url = `${base}/functions/v1/${name}${path}`
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${auth ?? anon}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    no(`${name} network`, String(err))
    return null
  }

  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    no(`${name} non-JSON (${res.status})`, text.slice(0, 200))
    return { res, json: null }
  }

  return { res, json }
}

function expectDataEnvelope(name, result) {
  if (!result) return
  const { res, json } = result
  if (res.status !== 200) {
    no(`${name} status ${res.status}`, JSON.stringify(json)?.slice(0, 300))
    return
  }
  if (!json || typeof json !== 'object') {
    no(`${name} missing JSON object`)
    return
  }
  if (!('data' in json)) {
    no(`${name} missing data key`, JSON.stringify(json).slice(0, 300))
    return
  }
  if (json.error) {
    no(`${name} unexpected error envelope`, JSON.stringify(json.error))
    return
  }
  ok(`${name} 200 + data`)
}

console.log(`== smoke against ${base} ==`)

const publicGets = [
  ['home-feed', ''],
  ['carousel-list', ''],
  ['trending-weekly', '?limit=5'],
  ['books-list', '?page=1&pageSize=5'],
  ['books-list', '?page=1&pageSize=5&language=urdu'],
  ['books-list', '?page=1&pageSize=5&sort=rating'],
  ['plans-list', ''],
  ['categories-list', ''],
  ['collections-list', ''],
  ['collection-books', `?slug=${encodeURIComponent(collectionSlug)}&page=1&pageSize=5`],
]

for (const [name, path] of publicGets) {
  const label = path ? `${name}${path}` : name
  const result = await invoke(name, { path })
  expectDataEnvelope(label, result)
}

{
  const result = await invoke('home-feed')
  if (result?.res?.status === 200 && result.json?.data && 'carousel' in result.json.data) {
    ok('home-feed includes carousel')
  } else if (result) {
    no('home-feed includes carousel', 'missing carousel key')
  }
}

if (userJwt) {
  console.log('== authenticated checks ==')
  for (const name of ['entitlements-status', 'profile-read', 'recommendations']) {
    const result = await invoke(name, { auth: userJwt })
    expectDataEnvelope(name, result)
  }

  {
    const result = await invoke('entitlements-status', { auth: userJwt })
    const data = result?.json?.data
    if (
      data &&
      typeof data.canAccessPremium === 'boolean' &&
      typeof data.reason === 'string' &&
      typeof data.serverTime === 'string' &&
      data.realtime?.channel
    ) {
      ok('entitlements-status lifecycle fields')
    } else if (result) {
      no('entitlements-status lifecycle fields', JSON.stringify(data)?.slice(0, 200))
    }
  }
} else {
  console.log('== authenticated checks skipped (set SUPABASE_USER_JWT to enable) ==')
}

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed`)
  process.exit(1)
}

console.log('\nAll smoke checks passed.')
