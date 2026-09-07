/**
 * Obtain JWTs for smoke:rls / smoke:hosted and print env lines (no secrets beyond JWT).
 * Usage: node scripts/print-smoke-jwts.mjs
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

async function token(email) {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${email}: ${JSON.stringify(body)}`)
  return body.access_token
}

const admin = await token('admin@gmail.com')
const user = await token('test@gmail.com')
process.env.SUPABASE_ADMIN_JWT = admin
process.env.SUPABASE_USER_JWT = user
console.log('JWTS_READY')

// Re-exec smoke scripts with env set
import { spawnSync } from 'node:child_process'
for (const script of ['scripts/rls-smoke.mjs', 'scripts/smoke-hosted.mjs']) {
  console.log(`\n== ${script} ==`)
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: {
      ...process.env,
      SUPABASE_ADMIN_JWT: admin,
      SUPABASE_USER_JWT: user,
    },
    stdio: 'inherit',
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
console.log('\nAUTHENTICATED_SMOKE_OK')
