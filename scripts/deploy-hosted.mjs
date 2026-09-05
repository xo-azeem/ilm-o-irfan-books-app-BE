/**
 * One-pass hosted deploy: link → db push → optional seed → functions → secrets.
 *
 * Required env:
 *   SUPABASE_PROJECT_REF
 *   SUPABASE_ACCESS_TOKEN   (or an existing `npx supabase login` session)
 *   REVENUECAT_WEBHOOK_AUTH
 *   REVENUECAT_ENTITLEMENT_ID   (default premium if unset is rejected — set explicitly)
 *   SIGNED_PDF_EXPIRES_IN
 *
 * Optional:
 *   DEPLOY_SEED=1                 run supabase/seed.sql after db push
 *   DEPLOY_ALLOW_PLACEHOLDER_RC=1 allow a staging-only placeholder webhook auth
 *   SUPABASE_DB_PASSWORD          passed to `supabase link` when non-interactive
 *
 * Usage:
 *   node scripts/deploy-hosted.mjs
 *   node scripts/deploy-hosted.mjs --help
 *   npm run deploy:hosted
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const PLACEHOLDER_RC_AUTH = 'Bearer STAGING_PLACEHOLDER_NOT_LIVE'

function printHelp() {
  console.log(`deploy-hosted — ship this repo to a linked Supabase project

Required environment:
  SUPABASE_PROJECT_REF          Project ref (subdomain of *.supabase.co)
  SUPABASE_ACCESS_TOKEN         Access token, or run: npx supabase login
  REVENUECAT_WEBHOOK_AUTH       Exact Authorization header RC will send
  REVENUECAT_ENTITLEMENT_ID     Usually "premium"
  SIGNED_PDF_EXPIRES_IN         Seconds, usually "300"

Optional:
  DEPLOY_SEED=1                 Apply supabase/seed.sql after migrations
  DEPLOY_ALLOW_PLACEHOLDER_RC=1 Use a staging placeholder if RC is not ready
  SUPABASE_DB_PASSWORD          Database password for non-interactive link

After success, copy SUPABASE_URL + anon key from the Dashboard into the app
(see docs/ops/fe-handoff.md). Then run: npm run smoke:hosted
`)
}

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

function runQuiet(args) {
  return spawnSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: process.env,
  })
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

loadDotEnv()

const ref = (process.env.SUPABASE_PROJECT_REF ?? '').trim()
if (!ref) die('SUPABASE_PROJECT_REF is required')

let rcAuth = (process.env.REVENUECAT_WEBHOOK_AUTH ?? '').trim()
const rcEntitlement = (process.env.REVENUECAT_ENTITLEMENT_ID ?? '').trim()
const pdfTtl = (process.env.SIGNED_PDF_EXPIRES_IN ?? '').trim()
const allowPlaceholder = process.env.DEPLOY_ALLOW_PLACEHOLDER_RC === '1'
const doSeed = process.env.DEPLOY_SEED === '1'

if (!rcAuth) {
  if (allowPlaceholder) {
    rcAuth = PLACEHOLDER_RC_AUTH
    console.warn(
      '\nWARN: DEPLOY_ALLOW_PLACEHOLDER_RC=1 — using staging placeholder webhook auth.',
    )
    console.warn('       RevenueCat is NOT live until you set a real secret.')
  } else {
    die(
      'REVENUECAT_WEBHOOK_AUTH is required (or set DEPLOY_ALLOW_PLACEHOLDER_RC=1 for staging)',
    )
  }
}

if (!rcEntitlement) die('REVENUECAT_ENTITLEMENT_ID is required (usually premium)')
if (!pdfTtl) die('SIGNED_PDF_EXPIRES_IN is required (usually 300)')

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.warn(
    '\nNOTE: SUPABASE_ACCESS_TOKEN unset — relying on an existing `supabase login` session.',
  )
}

const dbPassword = (process.env.SUPABASE_DB_PASSWORD ?? '').trim()
const linkArgs = ['supabase', 'link', '--project-ref', ref, '--yes']
if (dbPassword) {
  linkArgs.push('--password', dbPassword)
}

run('link project', linkArgs)
run('push migrations', ['supabase', 'db', 'push', '--yes'])

if (doSeed) {
  console.warn(
    '\nNOTE: seed.sql includes local-only auth users; on hosted they only apply if Auth allows inserts.',
  )
  console.warn('      Prefer Dashboard signup + admin promote for real accounts.')
  run('apply seed', [
    'supabase',
    'db',
    'query',
    '--linked',
    '--file',
    'supabase/seed.sql',
  ])
} else {
  console.log('\n== seed skipped == (set DEPLOY_SEED=1 to apply supabase/seed.sql)')
}

run('deploy edge functions', ['supabase', 'functions', 'deploy'])

// --env-file keeps values with spaces intact under Windows shell:true
const secretsFile = join(ROOT, '.tmp-hosted-secrets.env')
writeFileSync(
  secretsFile,
  [
    `REVENUECAT_WEBHOOK_AUTH=${rcAuth}`,
    `REVENUECAT_ENTITLEMENT_ID=${rcEntitlement}`,
    `SIGNED_PDF_EXPIRES_IN=${pdfTtl}`,
    '',
  ].join('\n'),
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

const unset = runQuiet([
  'supabase',
  'secrets',
  'unset',
  'ALLOW_PDF_WITHOUT_ENTITLEMENT',
  '--project-ref',
  ref,
])
if (unset.status === 0) {
  console.log('\n== unset ALLOW_PDF_WITHOUT_ENTITLEMENT (if it existed) ==')
} else {
  console.log(
    '\n== ALLOW_PDF_WITHOUT_ENTITLEMENT unset skipped (absent or not supported) ==',
  )
}

const url = `https://${ref}.supabase.co`
console.log(`
========================================================================
Deploy finished for project ${ref}

FE handoff (Dashboard → Settings → API):
  SUPABASE_URL=${url}
  SUPABASE_ANON_KEY=<anon / public key — never commit>

Webhook URL (when RevenueCat is ready):
  ${url}/functions/v1/revenuecat-webhook

Next:
  1. Dashboard → Authentication → enable Email provider
     (confirmations On for staging/prod)
  2. npm run smoke:hosted   # needs SUPABASE_URL + SUPABASE_ANON_KEY in env
  3. Sign up an admin, promote via SQL (deploy-checklist §F)
  4. docs/ops/fe-handoff.md for the mobile team
========================================================================
`)
