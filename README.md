# Ilm o Irfan — Backend

Supabase + PostgreSQL backend for the **Ilm o Irfan** React Native e-book app.

## Companion frontend

`D:\Projects\Ilm-o-Irfan-App-FE`

## Stack

| Layer | Technology |
| --- | --- |
| Platform | Supabase |
| Database | PostgreSQL |
| Auth | Supabase Auth (email + Google) |
| Files | Storage buckets `covers`, `pdfs`, `avatars` |
| Privileged logic | Edge Functions |
| Subscriptions | RevenueCat → webhook → `entitlements` |

Design & cost notes: [`docs/backend-stack.md`](docs/backend-stack.md)  
Schema reference: [`docs/schema.md`](docs/schema.md)  
**Setup + pgAdmin steps:** [`docs/setup-guide.md`](docs/setup-guide.md)

## Repo layout

```text
supabase/
  migrations/     # schema, RLS, storage
  functions/      # get-signed-pdf, revenuecat-webhook
  seed.sql        # sample catalog
sql/pgadmin/      # run in pgAdmin Query Tool
docs/             # stack, schema, setup
```

## Quick start (recommended)

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. Follow **Path A** in [`docs/setup-guide.md`](docs/setup-guide.md) to apply migrations + seed.
3. Register that database in **pgAdmin** (host `db.<project-ref>.supabase.co`, SSL required).
4. Copy `.env.example` → `.env` and fill API + DB values.
5. Deploy Edge Functions and set RevenueCat webhook secrets.

### Local schema-only (pgAdmin)

If you only want to browse tables on a local Postgres install:

1. Create database `ilm_o_irfan` in pgAdmin.
2. Run `sql/pgadmin/01_full_schema.sql`, then `sql/pgadmin/02_seed.sql`.

Full click-by-click instructions are in the setup guide.

## Scripts

```bash
npm install
npm run db:push          # push migrations to linked project
npm run functions:serve  # local functions (needs Docker + supabase start)
npm run types:generate   # TypeScript types from local DB
```

## Security rules (non-negotiable)

- PDF/cover **bytes** live in Storage — never in Postgres.
- Clients never write `entitlements` — webhook / service role only.
- Signed PDF URLs come from `get-signed-pdf` after auth + premium checks.
