/**
 * Enable Google provider on hosted Auth + deep-link allow list.
 *
 * Required in .env:
 *   SUPABASE_ACCESS_TOKEN
 *   SUPABASE_PROJECT_REF
 *   GOOGLE_CLIENT_ID          Web OAuth client ID (first). Optional: WEB,ANDROID,IOS comma list
 *   GOOGLE_CLIENT_SECRET      Web client secret
 *
 * Optional:
 *   AUTH_SITE_URL
 *   AUTH_APP_REDIRECTS        comma list, default ilmoirfan://**
 *   GOOGLE_SKIP_NONCE_CHECK=1 for native RN Google Sign-In without nonce
 *
 * Usage: node scripts/enable-hosted-google-auth.mjs
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
const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim()
const siteUrl =
  process.env.AUTH_SITE_URL?.trim() || (ref ? `https://${ref}.supabase.co` : '')
const appRedirects = (process.env.AUTH_APP_REDIRECTS ?? 'ilmoirfan://**')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const skipNonce =
  process.env.GOOGLE_SKIP_NONCE_CHECK === '1' ||
  process.env.GOOGLE_SKIP_NONCE_CHECK === 'true'

if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF required')
  process.exit(1)
}
if (!clientId || !clientSecret) {
  console.error(
    'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required (Web client; Web ID first if comma-list)',
  )
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
  external_google_enabled: true,
  external_google_client_id: clientId,
  external_google_secret: clientSecret,
  external_google_skip_nonce_check: skipNonce,
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

console.log('GOOGLE_AUTH_ENABLED', {
  project: ref,
  external_google_enabled: cfg.external_google_enabled,
  external_google_skip_nonce_check: cfg.external_google_skip_nonce_check,
  security_manual_linking_enabled: cfg.security_manual_linking_enabled,
  site_url: cfg.site_url,
  uri_allow_list: cfg.uri_allow_list,
  client_id_prefix: `${clientId.slice(0, 12)}…`,
})
console.log(
  'Google Cloud authorized redirect URI must include:',
  `https://${ref}.supabase.co/auth/v1/callback`,
)
