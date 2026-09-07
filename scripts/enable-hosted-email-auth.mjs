/**
 * Enable Email Auth on the linked hosted project (staging checklist §F).
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env
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

const token = (process.env.SUPABASE_ACCESS_TOKEN ?? '').trim()
const ref = (process.env.SUPABASE_PROJECT_REF ?? '').trim()
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN required')
  process.exit(1)
}
if (!ref) {
  console.error('SUPABASE_PROJECT_REF required')
  process.exit(1)
}

const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`

const get = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
const before = await get.json()
if (!get.ok) {
  console.error('GET failed', get.status, before)
  process.exit(1)
}

console.log('Before:', {
  external_email_enabled: before.external_email_enabled,
  disable_signup: before.disable_signup,
  mailer_autoconfirm: before.mailer_autoconfirm,
})

const patch = await fetch(url, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    external_email_enabled: true,
    disable_signup: false,
    // Confirmations On for staging (built-in Supabase mail)
    mailer_autoconfirm: false,
  }),
})
const after = await patch.json()
if (!patch.ok) {
  console.error('PATCH failed', patch.status, after)
  process.exit(1)
}

console.log('After:', {
  external_email_enabled: after.external_email_enabled,
  disable_signup: after.disable_signup,
  mailer_autoconfirm: after.mailer_autoconfirm,
})
console.log('AUTH_EMAIL_ENABLED')
