/**
 * Verify public cover URLs from home-feed resolve (HEAD/GET).
 * Usage: npm run smoke:covers   (or node scripts/verify-cover-urls.mjs)
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
if (!base || !anon) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY required')
  process.exit(1)
}

const feedRes = await fetch(`${base}/functions/v1/home-feed`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}` },
})
const feed = await feedRes.json()
if (!feedRes.ok) {
  console.error('home-feed failed', feedRes.status, feed)
  process.exit(1)
}

const cards = [
  ...(feed.data?.books ?? []),
  ...(feed.data?.shelves?.hero ?? []),
  ...(feed.data?.shelves?.trending ?? []),
  ...(feed.data?.shelves?.newArrivals ?? []),
]

const urls = [
  ...new Set(
    cards
      .map((b) => b.coverUrl)
      .filter((u) => typeof u === 'string' && u.startsWith('http')),
  ),
].slice(0, 25)

console.log(`Checking ${urls.length} unique coverUrl(s) from home-feed…`)

let failed = 0
let ok = 0
let skippedNull = cards.filter((b) => !b.coverUrl).length

for (const url of urls) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    // Some CDNs reject HEAD — fall back to GET range
    const status =
      res.status === 405 || res.status === 400
        ? (await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }))
            .status
        : res.status
    if (status >= 200 && status < 400) {
      ok += 1
      console.log(`  PASS  ${status}  ${url.slice(0, 90)}…`)
    } else {
      failed += 1
      console.error(`  FAIL  ${status}  ${url}`)
    }
  } catch (error) {
    failed += 1
    console.error(`  FAIL  ${error.message}  ${url}`)
  }
}

console.log(`\nok=${ok} fail=${failed} cards_without_coverUrl≈${skippedNull}`)
if (failed > 0 || urls.length === 0) process.exit(1)
console.log('COVER_URLS_OK')
