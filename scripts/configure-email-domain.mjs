#!/usr/bin/env node
/**
 * Resend sending domain: check verification, and once it is verified switch
 * EMAIL_FROM to it on the hosted project.
 *
 *   npm run email:domain            check status, print the DNS still missing
 *   npm run email:domain -- --apply when verified, set EMAIL_FROM as an Edge
 *                                   secret and rewrite it in .env
 *
 * Reads from .env: RESEND_API_KEY, EMAIL_DOMAIN (default ilmoirfanpublisher.com),
 * EMAIL_FROM_NAME (default "Ilm o Irfan"), EMAIL_FROM_LOCAL (default no-reply).
 *
 * Why this exists: until the domain is verified Resend only delivers to the
 * account owner's own address, so every auth / membership letter to a real
 * reader is refused with 403. Switching EMAIL_FROM *before* verification
 * breaks even that one address, which is why --apply refuses to run early.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const ENV_PATH = join(ROOT, '.env')

function loadDotEnv() {
  if (!existsSync(ENV_PATH)) return
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

const apply = process.argv.includes('--apply')
const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
const domain = (process.env.EMAIL_DOMAIN ?? 'ilmoirfanpublisher.com').trim().toLowerCase()
const fromName = (process.env.EMAIL_FROM_NAME ?? 'Ilm o Irfan').trim()
const fromLocal = (process.env.EMAIL_FROM_LOCAL ?? 'no-reply').trim()
const from = `${fromName} <${fromLocal}@${domain}>`

if (!apiKey) {
  console.error('RESEND_API_KEY is missing from .env')
  process.exit(1)
}

const resend = async (path, init = {}) => {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.message ?? ''}`)
  return body
}

const list = await resend('/domains')
const entry = (list.data ?? []).find((d) => d.name === domain)
if (!entry) {
  console.error(`Domain ${domain} is not added in Resend. Add it at https://resend.com/domains first.`)
  process.exit(1)
}

// A verify call is idempotent: it just asks Resend to re-check DNS now.
await resend(`/domains/${entry.id}/verify`, { method: 'POST' }).catch(() => {})
const detail = await resend(`/domains/${entry.id}`)

console.log(`Resend domain ${domain}: ${detail.status}`)
for (const r of detail.records ?? []) {
  const flag = r.status === 'verified' ? 'ok     ' : r.status.padEnd(7)
  console.log(`  ${flag} ${r.record.padEnd(5)} ${r.type.padEnd(5)} ${r.name.padEnd(18)} -> ${r.value}${r.priority ? `  (priority ${r.priority})` : ''}`)
}

if (detail.status !== 'verified') {
  console.log(`
Not verified yet. Add the records above at the DNS host for ${domain}
(nslookup -type=NS ${domain} tells you which), then run this again. DNS can
take up to a few hours to propagate; Resend re-checks each time you run it.
Recommended as well:  TXT  _dmarc  "v=DMARC1; p=none;"
EMAIL_FROM has NOT been changed.`)
  process.exit(apply ? 1 : 0)
}

if (!apply) {
  console.log(`\nVerified. Run with --apply to set EMAIL_FROM="${from}" on the hosted project and in .env.`)
  process.exit(0)
}

// --apply: Edge secret + .env, in that order, so a failed secrets call does
// not leave .env claiming a sender the project is not using.
const tmp = join(ROOT, '.tmp-email-from.env')
writeFileSync(tmp, `EMAIL_FROM=${from}\n`, 'utf8')
try {
  execFileSync('npx', ['supabase', 'secrets', 'set', '--env-file', tmp], { cwd: ROOT, stdio: 'inherit', shell: true })
} finally {
  unlinkSync(tmp)
}

const env = readFileSync(ENV_PATH, 'utf8')
const line = `EMAIL_FROM=${from}`
const next = /^EMAIL_FROM=.*$/m.test(env) ? env.replace(/^EMAIL_FROM=.*$/m, line) : `${env.replace(/\s*$/, '')}\n${line}\n`
writeFileSync(ENV_PATH, next, 'utf8')

console.log(`\nEMAIL_FROM is now "${from}" on the project and in .env.
Next: Dashboard -> Authentication -> Hooks -> Send Email -> enable, then
  npx supabase secrets set SEND_EMAIL_HOOK_SECRET=v1,whsec_...`)
