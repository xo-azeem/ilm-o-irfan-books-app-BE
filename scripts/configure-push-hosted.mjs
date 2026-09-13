/**
 * Turns on push notifications on the linked hosted project, in one pass:
 *
 *   1. db push            — 20260919120000_push_notifications.sql
 *   2. functions deploy   — push-dispatch
 *   3. secrets set        — PUSH_DISPATCH_SECRET, FCM_SERVICE_ACCOUNT_B64
 *   4. runtime_config     — supabase_url + push_dispatch_secret, so the
 *                           database knows where to kick and with what
 *
 * Reads `.env` (gitignored) for:
 *   PUSH_DISPATCH_SECRET      any long random string
 *   FCM_SERVICE_ACCOUNT_B64   base64 of the Firebase service-account JSON key
 *   SUPABASE_PROJECT_REF      optional; falls back to the linked project
 *   SUPABASE_URL              optional; derived from the ref when absent
 *
 * Re-runnable: every step is idempotent. Pass --skip-db to leave migrations
 * alone (e.g. when `db push` already ran), --only-config for step 4 alone.
 *
 * Usage:  node scripts/configure-push-hosted.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_REF = 'rwnmckrepvycydmtgvcq'

function die(msg) {
  console.error(`\nERROR: ${msg}`)
  process.exit(1)
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

function run(label, args, opts = {}) {
  console.log(`\n== ${label} ==`)
  console.log(`$ npx ${args.join(' ')}`)
  const result = spawnSync('npx', args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
    ...opts,
  })
  if (result.status !== 0) {
    die(`${label} failed (exit ${result.status ?? 'unknown'})`)
  }
}

loadDotEnv()

const args = new Set(process.argv.slice(2))
const onlyConfig = args.has('--only-config')
const skipDb = args.has('--skip-db')

const ref = (process.env.SUPABASE_PROJECT_REF ?? '').trim() || DEFAULT_REF
const url = (process.env.SUPABASE_URL ?? '').trim() || `https://${ref}.supabase.co`
const secret = (process.env.PUSH_DISPATCH_SECRET ?? '').trim()
const serviceAccount = (process.env.FCM_SERVICE_ACCOUNT_B64 ?? '').trim()

if (!secret) die('PUSH_DISPATCH_SECRET is missing from .env')
if (!serviceAccount && !onlyConfig) die('FCM_SERVICE_ACCOUNT_B64 is missing from .env')
if (/localhost|127\.0\.0\.1/.test(url)) {
  die(`SUPABASE_URL in .env points at a local stack (${url}); set SUPABASE_PROJECT_REF or a hosted URL`)
}

try {
  const parsed = JSON.parse(Buffer.from(serviceAccount || '', 'base64').toString('utf8') || '{}')
  if (!onlyConfig && (parsed.type !== 'service_account' || !parsed.private_key)) {
    die('FCM_SERVICE_ACCOUNT_B64 does not decode to a service-account key')
  }
  if (parsed.project_id) console.log(`Firebase project: ${parsed.project_id}`)
} catch {
  if (!onlyConfig) die('FCM_SERVICE_ACCOUNT_B64 is not valid base64 JSON')
}

if (!onlyConfig) {
  if (!skipDb) {
    run('push migrations', ['supabase', 'db', 'push', '--linked', '--yes'])
  }

  run('deploy push-dispatch', [
    'supabase',
    'functions',
    'deploy',
    'push-dispatch',
    '--project-ref',
    ref,
  ])

  // --env-file keeps the long base64 value intact under Windows shell:true.
  const secretsFile = join(ROOT, '.tmp-hosted-secrets.env')
  writeFileSync(
    secretsFile,
    [`PUSH_DISPATCH_SECRET=${secret}`, `FCM_SERVICE_ACCOUNT_B64=${serviceAccount}`, ''].join('\n'),
    'utf8',
  )
  try {
    run('set function secrets', [
      'supabase',
      'secrets',
      'set',
      '--env-file',
      secretsFile,
      '--project-ref',
      ref,
    ])
  } finally {
    unlinkSync(secretsFile)
  }
}

// Step 4 — the two rows private.push_dispatch_kick() reads. The secret is
// passed through a dollar-quoted literal so no character in it needs escaping.
const sqlFile = join(ROOT, '.tmp-push-config.sql')
writeFileSync(
  sqlFile,
  `insert into private.runtime_config (key, value) values
  ('supabase_url', $rc$${url}$rc$),
  ('push_dispatch_secret', $rc$${secret}$rc$)
on conflict (key) do update
  set value = excluded.value,
      updated_at = timezone('utc', now());
select key, updated_at from private.runtime_config where key in ('supabase_url', 'push_dispatch_secret');
`,
  'utf8',
)
try {
  run('write private.runtime_config', [
    'supabase',
    'db',
    'query',
    '--linked',
    '--file',
    sqlFile,
  ])
} catch (error) {
  console.error(
    '\nCould not run the SQL through the CLI. Paste this into Dashboard → SQL editor instead:\n',
  )
  console.error(readFileSync(sqlFile, 'utf8'))
  throw error
} finally {
  unlinkSync(sqlFile)
}

console.log(`
========================================================================
Push notifications configured on ${ref}

Check it moves (SQL editor):
  select id, kind, audience, status, count, attempts, last_error, sent_count
  from public.push_outbox order by id desc limit 10;

Then build the app with android/app/google-services.json in place, sign in,
and publish or delete a book from the admin app.
========================================================================
`)
