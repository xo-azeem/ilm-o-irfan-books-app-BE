/**
 * List Auth users + profiles on hosted project (service role).
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
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!base || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
}

const usersRes = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=20`, {
  headers,
})
const usersBody = await usersRes.json()
if (!usersRes.ok) {
  console.error('users', usersRes.status, usersBody)
  process.exit(1)
}

const users = usersBody.users ?? []
console.log('USER_COUNT', users.length)
for (const u of users) {
  console.log(
    JSON.stringify({
      id: u.id,
      email: u.email,
      confirmed: Boolean(u.email_confirmed_at),
      roleMeta: u.app_metadata?.app_role ?? null,
    }),
  )
}

const profilesRes = await fetch(
  `${base}/rest/v1/profiles?select=id,email,role&order=created_at.asc&limit=20`,
  { headers: { ...headers, Accept: 'application/json' } },
)
const profiles = await profilesRes.json()
if (!profilesRes.ok) {
  console.error('profiles', profilesRes.status, profiles)
  process.exit(1)
}
console.log('PROFILES', JSON.stringify(profiles, null, 2))
