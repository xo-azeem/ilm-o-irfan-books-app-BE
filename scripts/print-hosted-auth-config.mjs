/**
 * Print hosted Auth URI / rate-limit snapshot (Management API).
 * Usage: node scripts/print-hosted-auth-config.mjs
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
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF required')
  process.exit(1)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
})
const cfg = await res.json()
if (!res.ok) {
  console.error(res.status, cfg)
  process.exit(1)
}

const snapshot = {
  site_url: cfg.site_url,
  uri_allow_list: cfg.uri_allow_list,
  external_email_enabled: cfg.external_email_enabled,
  external_google_enabled: cfg.external_google_enabled,
  mailer_autoconfirm: cfg.mailer_autoconfirm,
  disable_signup: cfg.disable_signup,
  rate_limit_email_sent: cfg.rate_limit_email_sent,
  rate_limit_sms_sent: cfg.rate_limit_sms_sent,
  rate_limit_verify: cfg.rate_limit_verify,
  rate_limit_token_refresh: cfg.rate_limit_token_refresh,
  rate_limit_otp: cfg.rate_limit_otp,
  jwt_exp: cfg.jwt_exp,
}
console.log(JSON.stringify(snapshot, null, 2))
