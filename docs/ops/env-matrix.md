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
| `REVENUECAT_ENTITLEMENT_ID` | `ilm_o_irfan_pro` | `ilm_o_irfan_pro` | `ilm_o_irfan_pro` | Must match the entitlement id in RevenueCat and the app's `REVENUECAT_ENTITLEMENT_ID` |
| `SIGNED_PDF_EXPIRES_IN` | `300` | `300` | `300` | Seconds. Long enough to start a download, short enough not to be a share link |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | required to test Google | required | Configured in the Dashboard for hosted projects |

### Variables that no longer exist

`ALLOW_PDF_WITHOUT_ENTITLEMENT` is not read by any function, and
`app_settings.allow_pdf_without_entitlement` has been dropped from the schema.
`get-signed-pdf` grants access on the admin role or an active entitlement — nothing else,
and `is_premium` is not consulted. If either name turns up in a config, delete it; leaving
it there implies a switch that does not exist.

## Script and CI variables

These are for tooling, not for the deployed functions.

| Variable | Used by | Notes |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | `npm run deploy:hosted` | Hosted project ref |
| `SUPABASE_ACCESS_TOKEN` | deploy / types CLI | Or `npx supabase login` |
| `DEPLOY_SEED` | `deploy:hosted` | `1` to apply `supabase/seed.sql` |
| `DEPLOY_ALLOW_PLACEHOLDER_RC` | `deploy:hosted` | Staging-only placeholder webhook auth |
| `BOOKS_DIR` | `npm run books:import` | Folder of book assets to ingest |
| `DEFAULT_IS_PREMIUM` | `npm run books:import` | Default flag when `meta.json` omits it |
| `DRY_RUN` / `SQL_ONLY` | `npm run books:import` | Emit SQL without uploading |
| `ANON` / `SERVICE` | `npm run test:e2e` | Optional override; read from `supabase status` otherwise |
| `SUPABASE_USER_JWT` | `smoke:hosted` / `smoke:rls` | Optional authenticated checks |
| `SUPABASE_ADMIN_JWT` | `smoke:rls` | Optional admin checks (`isAdmin`) |

CI runs static checks on every push (contracts, Deno typecheck/lint/unit tests). Hosted
deploy is **manual only**:

| GitHub Actions secret | Used by |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | CLI auth in `deploy-hosted.yml` |
| `SUPABASE_PROJECT_REF_STAGING` | Staging project ref |
| `SUPABASE_DB_PASSWORD_STAGING` | Non-interactive `supabase link` (optional if already linked in CI) |
| `REVENUECAT_WEBHOOK_AUTH` | Function secret |
| `REVENUECAT_ENTITLEMENT_ID` | `ilm_o_irfan_pro` (the RevenueCat dashboard's entitlement identifier) |
| `SIGNED_PDF_EXPIRES_IN` | Usually `300` |

Workflow: **Actions → Deploy hosted (staging) → Run workflow**. Never on push.  
Local equivalent: `npm run deploy:hosted` (see [`deploy-checklist.md`](./deploy-checklist.md)).

Placeholder RC: set `DEPLOY_ALLOW_PLACEHOLDER_RC=1` (or the workflow checkbox) only on
staging when RevenueCat is not wired yet. Replace before any real purchase traffic.

## Deploying

```bash
# One pass (preferred)
DEPLOY_SEED=1 npm run deploy:hosted
npm run smoke:hosted
npm run smoke:rls
npm run types:generate   # after migrations, with linked project

# Or step by step
npm run link
npm run db:push
npm run functions:deploy
npm run types:generate
```

The full ordered procedure, including the checks that must pass before production, is in
[deploy-checklist.md](./deploy-checklist.md). Mobile env handoff: [fe-handoff.md](./fe-handoff.md).

## Before production, verify

- [ ] Paywall closed: a non-entitled user gets `403 PREMIUM_REQUIRED` on a premium book
- [ ] `REVENUECAT_WEBHOOK_AUTH` is not the staging value
- [ ] `supabase db advisors` security findings addressed
- [ ] `admin_storage_audit()` returns no broken references
- [ ] First admin promoted, and that account has signed out and back in
- [ ] Deep links and redirect URLs registered for both iOS and Android
- [ ] Pro plan enabled (PITR) if this holds real customer data
