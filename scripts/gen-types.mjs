/**
 * Regenerate types/database.ts from Supabase.
 *
 * A plain `supabase gen types ... > types/database.ts` truncates the file the
 * moment the shell opens the redirect, so a failed run (no Docker, no auth)
 * silently leaves an empty file behind. This writes only after the CLI exits 0.
 *
 * Usage: node scripts/gen-types.mjs [--linked|--local]
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const OUT_PATH = join(ROOT, 'types', 'database.ts')

const source = process.argv.includes('--local') ? '--local' : '--linked'

const result = spawnSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', source],
  { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 },
)

if (result.error) {
  console.error(`Could not run the Supabase CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(result.stderr?.trim() || `Supabase CLI exited with ${result.status}.`)
  console.error(
    source === '--linked'
      ? '\nRun `npx supabase login` first, or use `npm run types:generate:local`.'
      : '\nThe local stack must be running: `npm run supabase:start` (needs Docker).',
  )
  console.error('types/database.ts was left unchanged.')
  process.exit(result.status ?? 1)
}

const types = result.stdout
if (!types.includes('export type Database')) {
  console.error('Generated output did not look like a Database type. Nothing was written.')
  process.exit(1)
}

writeFileSync(OUT_PATH, types, 'utf8')
console.log(`Wrote types/database.ts from ${source.slice(2)} (${types.split('\n').length} lines).`)
