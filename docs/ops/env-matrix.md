# Environment matrix

Three environments, one schema, different data and different secrets.

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Where | Docker, `npx supabase start` | Its own Supabase project | Its own Supabase project |
| Postgres | 17 (`config.toml` `major_version`) | 17 | 17 |
| Data | `supabase/seed.sql` + e2e fixtures | Real-shaped sample catalog | The real catalog |
| Migrations | `npm run db:reset` | `npm run db:push` | `npm run db:push` after staging passes |
| Auth confirmations | Off | On | On |
| RevenueCat | Sandbox | Sandbox | Production |
| Plan | Free | Free is fine | **Pro** (PITR, backups) before launch |

Staging exists so migrations and functions are exercised against a real Supabase before the
catalog people pay for. Promotion is always local → staging → production, never a direct
push to production.

**Keep the Postgres major version in step.** `supabase/config.toml` shipped
`major_version = 15` while the hosted project ran 17.6, so local was never a faithful
rehearsal of production — a migration relying on version-specific behaviour could pass
locally and fail on deploy. Check with:

```bash
# local
docker exec supabase_db_ilm-o-irfan psql -U postgres -d postgres -tAc "show server_version;"
# hosted (Dashboard → Settings → Database, or)
npx supabase projects list
```

Changing `major_version` requires `npx supabase stop --no-backup` and a fresh
`npx supabase start`; it recreates the local volume, so local data does not survive.

## Function secrets

Set with `npx supabase secrets set KEY=value --project-ref <ref>`; read back the names (not
the values) with `npx supabase secrets list`.

| Variable | Local | Staging | Production | Notes |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | injected | injected | injected | Provided by the platform; do not set by hand |
| `SUPABASE_ANON_KEY` | injected | injected | injected | Also shipped in the app |
| `SUPABASE_SERVICE_ROLE_KEY` | injected | injected | injected | Never leaves function secrets |
| `REVENUECAT_WEBHOOK_AUTH` | any test value | staging-only secret | its own rotated secret | Must match RevenueCat exactly; never shared between environments |
| `REVENUECAT_ENTITLEMENT_ID` | `premium` | `premium` | `premium` | Must match the entitlement id in RevenueCat |
| `SIGNED_PDF_EXPIRES_IN` | `300` | `300` | `300` | Seconds. Long enough to start a download, short enough not to be a share link |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | required to test Google | required | Configured in the Dashboard for hosted projects |

### Variables that no longer exist

`ALLOW_PDF_WITHOUT_ENTITLEMENT` and `app_settings.allow_pdf_without_entitlement` are not
read by any function. `get-signed-pdf` grants access on admin, free-and-published, or an
active entitlement — nothing else. If either name turns up in a config, delete it; leaving
it there implies a switch that does not exist.

## Script and CI variables

These are for tooling, not for the deployed functions.

| Variable | Used by | Notes |
| --- | --- | --- |
| `BOOKS_DIR` | `npm run books:import` | Folder of book assets to ingest |
| `DEFAULT_IS_PREMIUM` | `npm run books:import` | Default flag when `meta.json` omits it |
| `DRY_RUN` / `SQL_ONLY` | `npm run books:import` | Emit SQL without uploading |
| `ANON` / `SERVICE` | `npm run test:e2e` | Optional override; read from `supabase status` otherwise |

CI runs only the checks that need no project: contract checks, secret scan, typecheck,
lint, and unit tests. Nothing in `.github/workflows/` holds a project secret today; adding
a deploy workflow means adding `SUPABASE_ACCESS_TOKEN` and a project ref as repository
secrets, and that is a deliberate decision, not a default.

## Deploying

```bash
npm run link                                    # pick the project
npm run db:push                                 # migrations
npm run functions:deploy                        # every function in supabase/functions
npm run types:generate                          # regenerate types/database.ts after migrations
```

The full ordered procedure, including the checks that must pass before production, is in
[deploy-checklist.md](./deploy-checklist.md).

## Before production, verify

- [ ] Paywall closed: a non-entitled user gets `403 PREMIUM_REQUIRED` on a premium book
- [ ] `REVENUECAT_WEBHOOK_AUTH` is not the staging value
- [ ] `supabase db advisors` security findings addressed
- [ ] `admin_storage_audit()` returns no broken references
- [ ] First admin promoted, and that account has signed out and back in
- [ ] Deep links and redirect URLs registered for both iOS and Android
- [ ] Pro plan enabled (PITR) if this holds real customer data
