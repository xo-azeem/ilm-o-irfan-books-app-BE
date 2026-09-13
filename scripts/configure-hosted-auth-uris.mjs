/**
 * Set staging Auth site_url + redirect allow list (email recovery + OAuth return).
 * Does not enable Google by itself — use enable-hosted-google-auth.mjs for that.
 *
 * Usage: node scripts/configure-hosted-auth-uris.mjs
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
const siteUrl =
  process.env.AUTH_SITE_URL?.trim() ||
  `https://${ref}.supabase.co`
const appRedirects = (process.env.AUTH_APP_REDIRECTS ?? 'ilmoirfan://**')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF required')
  process.exit(1)
}

const allowList = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  siteUrl,
  `${siteUrl}/**`,
  ...appRedirects,
]
  .filter(Boolean)
  .join(',')

const body = {
  site_url: siteUrl,
  uri_allow_list: allowList,
  security_manual_linking_enabled: true,
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})
const cfg = await res.json()
if (!res.ok) {
  console.error('PATCH failed', res.status, cfg)
  process.exit(1)
}

console.log('AUTH_URIS_UPDATED', {
  site_url: cfg.site_url,
  uri_allow_list: cfg.uri_allow_list,
  security_manual_linking_enabled: cfg.security_manual_linking_enabled,
  rate_limit_email_sent: cfg.rate_limit_email_sent,
  external_google_enabled: cfg.external_google_enabled,
})
