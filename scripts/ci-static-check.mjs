/**
 * Static CI checks that do not need Docker or a linked Supabase project.
 * - Every deployable function folder is listed in config.toml
 * - Every endpoint-manifest name has a matching folder
 * - Fixture JSON files parse
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      } else if (!('data' in parsed) && !('error' in parsed)) {
        no(`${file} must have data or error envelope`)
      } else {
        ok(file)
      }
    } catch (error) {
      no(`${file} invalid JSON`, error.message)
    }
  }
}

console.log('== migrations present ==')
const migDir = join(ROOT, 'supabase', 'migrations')
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql'))
if (migs.length < 10) {
  no(`expected >= 10 migrations, found ${migs.length}`)
} else {
  ok(`${migs.length} migration files`)
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}

console.log('\nAll static checks passed.')
