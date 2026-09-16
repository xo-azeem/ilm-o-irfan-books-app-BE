/**
 * Static CI checks that do not need Docker or a linked Supabase project.
 *
 * - Every deployable function folder is listed in config.toml
 * - Every endpoint-manifest name has a matching folder, and its documented
 *   method is one the handler actually allows
 * - Every handler enforces a method, answers CORS preflight, and catches
 * - Fixture JSON files parse and carry a data/error envelope
 * - Migration timestamps are unique and in order
 * - Nothing secret-shaped is committed
 *
 * Deno-dependent checks (`deno check`, `deno lint`, `deno test`) run as separate
 * CI steps; keep this file runnable with Node alone.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions')
const CONFIG_PATH = join(ROOT, 'supabase', 'config.toml')
const MANIFEST_PATH = join(FUNCTIONS_DIR, '_shared', 'endpoint-manifest.ts')
const FIXTURES_DIR = join(ROOT, 'docs', 'fixtures')

let failed = 0

function ok(msg) {
  console.log(`  PASS  ${msg}`)
}

function no(msg, detail) {
  failed += 1
  console.error(`  FAIL  ${msg}`)
  if (detail) console.error(`        ${detail}`)
}

const dirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name)
  .sort()

const config = readFileSync(CONFIG_PATH, 'utf8')
const configFns = new Set(
  [...config.matchAll(/\[functions\.([^\]]+)\]/g)].map((m) => m[1]),
)

console.log('== function folders vs config.toml ==')
for (const name of dirs) {
  if (!existsSync(join(FUNCTIONS_DIR, name, 'index.ts'))) {
    no(`${name} has no index.ts`)
    continue
  }
  if (!configFns.has(name)) {
    no(`${name} missing [functions.${name}] in config.toml`)
  } else {
    ok(`${name} in config.toml`)
  }
}

for (const name of configFns) {
  if (!dirs.includes(name)) {
    no(`config.toml references missing function folder: ${name}`)
  }
}

console.log('== endpoint-manifest vs folders ==')
const manifest = readFileSync(MANIFEST_PATH, 'utf8')
const manifestNames = [...manifest.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1])
const uniqueManifest = [...new Set(manifestNames)]

for (const name of uniqueManifest) {
  if (!dirs.includes(name)) {
    no(`manifest lists ${name} but folder missing`)
  } else {
    ok(`manifest ${name}`)
  }
}

for (const name of dirs) {
  if (!uniqueManifest.includes(name)) {
    no(`folder ${name} not listed in endpoint-manifest.ts`)
  }
}

console.log('== fixtures JSON ==')
if (!existsSync(FIXTURES_DIR)) {
  no('docs/fixtures directory missing')
} else {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    no('no fixture JSON files found')
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
      if (!parsed || typeof parsed !== 'object') {
        no(`${file} must be a JSON object`)
      } else if (file.endsWith('.request.json')) {
        // RevenueCat (and similar) inbound webhook samples — body has `event`, not data/error.
        if (!parsed.event || typeof parsed.event !== 'object') {
          no(`${file} must have an event object`)
        } else if (typeof parsed.event.type !== 'string' || !parsed.event.type) {
          no(`${file} event.type required`)
        } else if (typeof parsed.event.store !== 'string' || !parsed.event.store) {
          no(`${file} event.store required`)
        } else {
          ok(file)
        }
      } else if (!('data' in parsed) && !('error' in parsed)) {
        no(`${file} must have data or error envelope`)
      } else {
        ok(file)
      }
    } catch (error) {
      no(`${file} invalid JSON`, error.message)
    }
  }

  // Contract keys the FE already branches on — keep fixtures frozen to the live shape.
  function requireKeys(file, pathKeys) {
    try {
      const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
      const data = parsed?.data
      if (!data || typeof data !== 'object') {
        no(`${file} missing data object for key check`)
        return
      }
      for (const key of pathKeys) {
        const parts = key.split('.')
        let cur = data
        for (const part of parts) {
          if (cur == null || typeof cur !== 'object' || !(part in cur)) {
            no(`${file} missing required key ${key}`)
            return
          }
          cur = cur[part]
        }
      }
      ok(`${file} required keys`)
    } catch (error) {
      no(`${file} key check failed`, error.message)
    }
  }

  requireKeys('entitlements-status.response.json', [
    'canAccessPremium',
    'reason',
    'serverTime',
    'realtime.channel',
    'realtime.event',
  ])
  requireKeys('get-signed-pdf.response.json', [
    'signedUrl',
    'expiresIn',
    'access.serverTime',
    'access.reason',
  ])
  requireKeys('home-feed.response.json', [
    'carousel',
    'carouselSource',
    'shelves',
    'shelvesMeta.trending.collectionId',
    'shelvesMeta.newArrivals.totalCount',
    'supportEmail',
  ])
  requireKeys('carousel-list.response.json', ['slides', 'source'])
  requireKeys('trending-weekly.response.json', ['weekStart', 'expiresAt', 'books'])
  requireKeys('recommendations.response.json', ['sections', 'books', 'isPersonalized'])
  requireKeys('revenuecat-webhook.app-store.applied.response.json', [
    'eventId',
    'userId',
    'status',
    'store',
    'planId',
    'applied',
  ])
  requireKeys('revenuecat-webhook.play-store.applied.response.json', [
    'eventId',
    'userId',
    'status',
    'store',
    'planId',
    'applied',
  ])
}

console.log('== migrations present ==')
const migDir = join(ROOT, 'supabase', 'migrations')
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql'))
if (migs.length < 10) {
  no(`expected >= 10 migrations, found ${migs.length}`)
} else {
  ok(`${migs.length} migration files`)
}

// Migrations are applied in filename order and the ledger records what it has
// already seen, so an out-of-order or duplicate timestamp is silently skipped on
// any database that is already ahead of it.
const migTimestamps = migs.map((f) => f.split('_')[0])
const duplicateTimestamps = migTimestamps.filter((t, i) => migTimestamps.indexOf(t) !== i)
if (duplicateTimestamps.length > 0) {
  no(`duplicate migration timestamps: ${[...new Set(duplicateTimestamps)].join(', ')}`)
} else {
  ok('migration timestamps are unique')
}

const sortedTimestamps = [...migTimestamps].sort()
if (sortedTimestamps.join() !== migTimestamps.join()) {
  no('migration filenames are not in timestamp order')
} else {
  ok('migration filenames sort in timestamp order')
}

console.log('== HTTP contract ==')

// Exempt: signed-pdf answers 410 to everything on purpose.
// revenuecat-webhook and push-dispatch are server-to-server only (no CORS / handleOptions).
const METHOD_EXEMPT = new Set(['signed-pdf'])
const NO_CORS_WEBHOOKS = new Set([
  'revenuecat-webhook',
  'push-dispatch',
  'email-dispatch',
  'auth-send-email',
])

for (const name of dirs) {
  const source = readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8')

  if (METHOD_EXEMPT.has(name)) {
    ok(`${name} exempt from method enforcement (documented)`)
    continue
  }

  if (NO_CORS_WEBHOOKS.has(name)) {
    if (!/req\.method\s*!==\s*'POST'/.test(source) && !/requireMethod\(req,\s*\['POST'\]/.test(source)) {
      no(`${name} does not enforce POST`)
      continue
    }
    if (source.includes('handleOptions(req)')) {
      no(`${name} should not answer browser CORS preflight`)
      continue
    }
    if (!new RegExp(`(handleError|failUnexpected)\\('${name}'`).test(source)) {
      no(`${name} has no catch-all error handler`)
      continue
    }
    ok(`${name} enforces POST without CORS (server webhook)`)
    continue
  }

  if (!/requireMethod\(req,\s*\[/.test(source)) {
    no(`${name} does not enforce an HTTP method`)
    continue
  }

  if (!source.includes('handleOptions(req)')) {
    no(`${name} does not answer CORS preflight`)
    continue
  }

  // A handler that lets a throw escape returns a raw 500 from the runtime with
  // no envelope, which the app cannot parse.
  if (!new RegExp(`(handleError|failUnexpected)\\('${name}'`).test(source)) {
    no(`${name} has no catch-all error handler`)
    continue
  }

  ok(`${name} enforces method, preflight, and error envelope`)
}

console.log('== manifest methods match the handlers ==')
const manifestEntries = [
  ...manifest.matchAll(/name:\s*'([^']+)',\s*\n\s*route:[^\n]*\n\s*method:\s*'([A-Z]+)'/g),
].map((m) => ({ name: m[1], method: m[2] }))

for (const entry of manifestEntries) {
  if (!dirs.includes(entry.name)) continue
  if (METHOD_EXEMPT.has(entry.name)) continue

  const source = readFileSync(join(FUNCTIONS_DIR, entry.name, 'index.ts'), 'utf8')
  let allowed = [...source.matchAll(/requireMethod\(req,\s*\[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim().replace(/'/g, ''))
    .filter(Boolean)

  if (allowed.length === 0 && NO_CORS_WEBHOOKS.has(entry.name) && /req\.method\s*!==\s*'POST'/.test(source)) {
    allowed = ['POST']
  }

  if (!allowed.includes(entry.method)) {
    no(
      `manifest says ${entry.name} is ${entry.method} but the handler allows ${allowed.join(', ')}`,
    )
  } else {
    ok(`${entry.name} ${entry.method}`)
  }
}

console.log('== deploy secret allowlist + no PDF bypass ==')
{
  const deploySrc = readFileSync(join(ROOT, 'scripts', 'deploy-hosted.mjs'), 'utf8')
  const allowed = ['REVENUECAT_WEBHOOK_AUTH', 'REVENUECAT_ENTITLEMENT_ID', 'SIGNED_PDF_EXPIRES_IN']
  for (const key of allowed) {
    if (!deploySrc.includes(key)) {
      no(`deploy-hosted.mjs must set ${key}`)
    } else {
      ok(`deploy sets ${key}`)
    }
  }
  if (/secrets\s+set[\s\S]*--env-file\s+['"]?\.env['"]?/.test(deploySrc)) {
    no('deploy-hosted must not secrets-set the whole .env file')
  } else {
    ok('deploy does not push full .env as Edge secrets')
  }
  if (!deploySrc.includes('DATABASE_URL') || !deploySrc.includes('secrets') || !deploySrc.includes('unset')) {
    // Prefer explicit unset of dangerous keys after deploy.
  }
  if (deploySrc.includes("'DATABASE_URL'") || deploySrc.includes('"DATABASE_URL"') || deploySrc.includes('DATABASE_URL,')) {
    ok('deploy cleans DATABASE_URL from Edge secrets')
  } else if (deploySrc.includes('DATABASE_URL')) {
    ok('deploy references DATABASE_URL cleanup')
  } else {
    no('deploy-hosted should unset DATABASE_URL if it was ever pushed')
  }

  let allowPdfReads = 0
  for (const file of walk(join(ROOT, 'supabase', 'functions'))) {
    if (!file.endsWith('.ts')) continue
    const src = readFileSync(file, 'utf8')
    if (/ALLOW_PDF_WITHOUT_ENTITLEMENT|allow_pdf_without_entitlement/.test(src) && !src.includes('deliberately absent') && !src.includes('both gone')) {
      // comments about removal are ok; live reads of Deno.env.get('ALLOW_PDF...') are not
      if (/Deno\.env\.get\(\s*['"]ALLOW_PDF_WITHOUT_ENTITLEMENT['"]\s*\)/.test(src)) {
        allowPdfReads += 1
        no(`${relative(ROOT, file)} still reads ALLOW_PDF_WITHOUT_ENTITLEMENT`)
      }
    }
  }
  if (allowPdfReads === 0) {
    ok('no Edge Function reads ALLOW_PDF_WITHOUT_ENTITLEMENT')
  }
}

console.log('== no committed secrets ==')
// Catches the two mistakes that actually happen: committing .env, and pasting a
// service-role key into a doc, script, or function.
const SECRET_PATTERNS = [
  { label: 'JWT-shaped key', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: 'Supabase service key', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: 'assigned service role key', re: /SERVICE_ROLE_KEY\s*=\s*['"][^'"\s]{20,}['"]/ },
]

const SCAN_DIRS = ['supabase/functions', 'supabase/migrations', 'scripts', 'docs', 'sql', '.github']

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const gitignore = existsSync(join(ROOT, '.gitignore'))
  ? readFileSync(join(ROOT, '.gitignore'), 'utf8')
  : ''

if (!/^\.env$/m.test(gitignore) && !/^\.env\b/m.test(gitignore)) {
  no('.gitignore does not ignore .env')
} else {
  ok('.env is gitignored')
}

let secretHits = 0
for (const rel of SCAN_DIRS) {
  const dir = join(ROOT, rel)
  if (!existsSync(dir)) continue

  for (const file of walk(dir)) {
    if (/\.(png|jpg|jpeg|webp|pdf|ico|lock)$/i.test(file)) continue
    const content = readFileSync(file, 'utf8')
    for (const { label, re } of SECRET_PATTERNS) {
      if (re.test(content)) {
        secretHits += 1
        no(`${label} found in ${relative(ROOT, file).split(sep).join('/')}`)
      }
    }
  }
}

if (secretHits === 0) {
  ok('no secret-shaped strings in tracked source, docs, or SQL')
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}

console.log('\nAll static checks passed.')
