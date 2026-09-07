/**
 * Smoke: request password recovery email for a known staging user.
 * Confirms Auth accepts the recovery request (does not prove inbox delivery).
 *
 * Usage: node scripts/verify-password-recovery.mjs [email]
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
const email = process.argv[2] ?? 'test@gmail.com'
const redirectTo =
  process.env.PASSWORD_RECOVERY_REDIRECT ??
  `${base}/auth/v1/verify`

if (!base || !anon) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY required')
  process.exit(1)
}

const res = await fetch(`${base}/auth/v1/recover`, {
  method: 'POST',
  headers: {
    apikey: anon,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, redirect_to: redirectTo }),
})

const text = await res.text()
let body = null
try {
  body = text ? JSON.parse(text) : null
} catch {
  body = text
}

// GoTrue returns 200 with empty body on success (even for unknown emails, to avoid enumeration)
if (res.status === 200) {
  console.log('PASSWORD_RECOVERY_REQUEST_OK', { email, redirectTo })
  process.exit(0)
}

console.error('PASSWORD_RECOVERY_FAILED', res.status, body)
process.exit(1)
