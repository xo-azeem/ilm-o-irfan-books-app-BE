# Backend setup guide — Supabase + pgAdmin

This repo is the **Supabase** backend for Ilm o Irfan. PostgreSQL is the database engine *inside* Supabase — not a separate competing API.

## What you get in this repo

| Path | Purpose |
| --- | --- |
| `supabase/migrations/` | Production schema, RLS, storage buckets, admin CMS, search |
| `supabase/functions/` | Full app/admin API (~28 Edge Functions): catalog, library, PDF, webhook, admin |
| `supabase/seed.sql` | Baseline categories, subscription plan, local-only test users |
| `sql/pgadmin/` | Same schema/seed for running in pgAdmin Query Tool |
| `.env.example` | Keys / connection placeholders (paywall bypass defaults **off**) |

---

## Path A (recommended): Supabase cloud + pgAdmin

Use this for the real app (Auth, Storage, Edge Functions, RLS).

### 1. Create a Supabase project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. **New project** → pick org, name (e.g. `ilm-o-irfan`), database password (save it), region closest to you.
3. Wait until the project is healthy.

### 2. Apply schema

**Option 2a — Dashboard SQL (fastest first time)**

1. In Supabase: **SQL Editor** → New query.
2. Paste and run, in order (skip the empty stub `20260802110539_new-migration.sql`):
   - contents of `supabase/migrations/20260726120000_init_schema.sql`
   - contents of `supabase/migrations/20260726120100_rls_policies.sql`
   - contents of `supabase/migrations/20260726120200_storage_buckets.sql`
   - contents of `supabase/migrations/20260814114738_harden_grants_rls_indexes.sql`
   - contents of `supabase/migrations/20260814120331_harden_function_search_path.sql`
   - contents of `supabase/migrations/20260816194000_admin_roles_cms.sql`
   - contents of `supabase/migrations/20260826220000_app_settings_pdf_access.sql`
   - contents of `supabase/migrations/20260830120000_admin_cms_v2.sql`
   - contents of `supabase/migrations/20260831130000_search_views_and_admin_fixes.sql`
   - contents of `supabase/migrations/20260831140000_revenuecat_events_idempotency.sql`
   - contents of `supabase/seed.sql`

Prefer **Option 2b** (`db push`) so migration history stays consistent.

**Option 2b — CLI (best long-term)**

```bash
cd D:/ilm-o-irfan-books-app-BE
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase db query --file supabase/seed.sql
```

`YOUR_PROJECT_REF` is the subdomain in `https://YOUR_PROJECT_REF.supabase.co`.

### 3. Deploy Edge Functions

Deploy everything at once — this also picks up `supabase/functions/_shared/`, which every
function now imports:

```bash
npx supabase functions deploy
```

Or one at a time:

```bash
npx supabase functions deploy get-signed-pdf
npx supabase functions deploy signed-pdf   # deprecated alias, answers 410
npx supabase functions deploy revenuecat-webhook
npx supabase functions deploy home-feed
npx supabase functions deploy books-list
npx supabase functions deploy book-detail
npx supabase functions deploy books-search
npx supabase functions deploy categories-list
npx supabase functions deploy collections-list
npx supabase functions deploy plans-list
npx supabase functions deploy profile-read
npx supabase functions deploy profile-update
npx supabase functions deploy reading-progress
npx supabase functions deploy wishlist-list
npx supabase functions deploy wishlist-toggle
npx supabase functions deploy downloads-list
npx supabase functions deploy downloads-create
npx supabase functions deploy highlights-list
npx supabase functions deploy highlights-upsert
npx supabase functions deploy library-overview
npx supabase functions deploy entitlements-status
npx supabase functions deploy admin-books
npx supabase functions deploy admin-book-update
npx supabase functions deploy admin-categories
npx supabase functions deploy admin-collections
npx supabase functions deploy admin-users
npx supabase functions deploy admin-analytics
npx supabase functions deploy admin-settings
```

Set secrets (Dashboard → Edge Functions → Secrets, or CLI):

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer your-shared-secret"
npx supabase secrets set REVENUECAT_ENTITLEMENT_ID="premium"
npx supabase secrets set SIGNED_PDF_EXPIRES_IN="300"
# Production / public staging: keep the paywall CLOSED.
npx supabase secrets set ALLOW_PDF_WITHOUT_ENTITLEMENT="false"
# Local/dev open-paywall ONLY (never on a public project):
# npx supabase secrets set ALLOW_PDF_WITHOUT_ENTITLEMENT="true"
# Also toggled from Admin → Overview ("Free PDF access") via app_settings.
```

### 4. Auth providers

In Supabase **Authentication → Providers**:

- Enable **Email** (required for launch)
- Enable **Google** when ready (add OAuth client ID/secret from Google Cloud Console; set iOS/Android redirect / deep-link URLs)
- Local `supabase/config.toml` has `[auth.external.google] enabled = false` until those credentials exist

Email confirmation policy (`enable_confirmations`) is a launch decision — local defaults leave confirmations off for easier testing.

### 5. Connect pgAdmin to Supabase Postgres

1. Install [pgAdmin 4](https://www.pgadmin.org/download/) if needed.
2. In Supabase: **Project Settings → Database**.
3. Copy:
   - **Host**: `db.YOUR_PROJECT_REF.supabase.co`
   - **Database**: `postgres`
   - **Port**: `5432` (direct) or pooler port if shown
   - **User**: `postgres`
   - **Password**: the DB password you set at project creation
4. In pgAdmin:
   1. Right-click **Servers** → **Register** → **Server…**
   2. **General** tab → Name: `Ilm o Irfan Supabase`
   3. **Connection** tab:
      - Host name/address: `db.YOUR_PROJECT_REF.supabase.co`
      - Port: `5432`
      - Maintenance database: `postgres`
      - Username: `postgres`
      - Password: (your DB password)
      - Save password: optional
   4. **SSL** tab → SSL mode: **Require** (Supabase needs SSL)
   5. Click **Save**
5. Expand: `Ilm o Irfan Supabase` → Databases → `postgres` → Schemas → `public` → Tables  
   You should see `authors`, `books`, `profiles`, etc.

If connection times out: allow your IP under Supabase **Database → Network / Restrictions**, or temporarily use `0.0.0.0/0` only for local dev.

### 6. App keys for the React Native FE

From **Settings → API**, put into FE env (and BE `.env`):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (client)
- Keep `service_role` only in Edge Functions / server — never in the app.

---

## Path B: Local PostgreSQL + pgAdmin (schema exploration only)

Use this if you want to inspect tables locally without Supabase Auth/Storage. **The mobile app still needs Path A for Auth, Storage, and Edge Functions.**

### 1. Install PostgreSQL + pgAdmin

1. Download PostgreSQL for Windows: [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/)  
   The installer can include **pgAdmin**.
2. During setup, set a password for the `postgres` superuser and keep port **5432**.
3. Finish install and open pgAdmin.

### 2. Register a local server in pgAdmin

1. Right-click **Servers** → **Register** → **Server…**
2. **General**: Name = `Local Postgres`
3. **Connection**:
   - Host: `localhost`
   - Port: `5432`
   - Maintenance database: `postgres`
   - Username: `postgres`
   - Password: (password from installer)
4. Save → connect.

### 3. Create the app database

1. Right-click **Databases** → **Create** → **Database…**
2. Database name: `ilm_o_irfan`
3. Owner: `postgres`
4. Save.

### 4. Run the schema + seed

Select database `ilm_o_irfan` → open **Query Tool**, then execute each script with F5 **in
this order**. They are the pgAdmin twins of `supabase/migrations/`, and each one depends on
the ones before it — skipping any leaves the database in a half-configured state (no RLS
hardening, no admin roles, or no search index).

| # | Script | What it adds |
| --- | --- | --- |
| 1 | `01_full_schema.sql` | Tables, views, functions, storage buckets |
| 2 | `02_seed.sql` | Catalog seed data |
| 3 | `03_harden_grants_rls_indexes.sql` | RLS policies, grants, indexes |
| 4 | `04_admin_roles.sql` | `profiles.role`, `is_admin()`, admin policies |
| 5 | `05_remove_dummy_seed_books.sql` | Clears placeholder books |
| 6 | `06_app_settings.sql` | Product flags singleton |
| 7 | `07_admin_cms_v2.sql` | Admin CMS views, audit log, analytics |
| 8 | `08_search_views_and_admin_fixes.sql` | Search index incl. author, `service_role` grants, closed PDF paywall |

Then refresh **Tables** — you should see catalog data.

### Local development accounts

`supabase/seed.sql` creates two sign-in-ready accounts on every `supabase start` / `db reset`,
mirroring the hosted project. Both use the password `Password123!`.

| Email | Role | Premium access via |
| --- | --- | --- |
| `admin@gmail.com` | `admin` | admin role bypass — no subscription needed |
| `test@gmail.com` | `user` | comped entitlement (promotional, never expires) |

`seed.sql` runs against the **local stack only** — `supabase db push` does not execute it, so
these accounts cannot reach the hosted project.

> Script 08 is required. `books-search` calls `public.search_books()`, which only exists after
> it runs, and the admin endpoints cannot read `app_settings` without the `service_role`
> grants it restores.

Quick check:

```sql
select title, rating, is_premium from public.books order by rating desc;
select label, book_count from public.category_with_counts;
```

---

## Path C: Local Supabase via Docker (full local stack)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cd D:/ilm-o-irfan-books-app-BE
npm install
npx supabase start
```

Then:

- API: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`
- DB port for pgAdmin: **54322** (see `npx supabase status`)

pgAdmin connection for local Supabase:

| Field | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `54322` |
| Database | `postgres` |
| User | `postgres` |
| Password | from `supabase status` (usually `postgres`) |
| SSL | Prefer / Disable for local |

---

## Storage layout

| Bucket | Public? | DB columns |
| --- | --- | --- |
| `covers` | Yes | `books.cover_path` e.g. `covers/slug.webp` |
| `pdfs` | No | `books.pdf_path` e.g. `pdfs/slug.pdf` |
| `avatars` | No | `profiles.avatar_path` e.g. `{user_id}/avatar.webp` |

Upload cover and PDF files in Dashboard → Storage using the paths stored on each book.

PDFs are only served via **`get-signed-pdf`**. A signed-in user can open a book when any of these is true:

- they are an **admin** (`profiles.role` / JWT `app_metadata.app_role`)
- **`ALLOW_PDF_WITHOUT_ENTITLEMENT`** Edge Function env is `true` / `1` / `yes` / `on`
- **`app_settings.allow_pdf_without_entitlement`** is on (Admin → Overview switch)
- the book is **free** (`is_premium = false`) and published
- the book is **premium** and they have an **active entitlement**

Admins may also preview unpublished drafts. Turn the bypass switch and env **off** before a public release.

### Promote the first admin

After you have signed up in the app:

```sql
update public.profiles set role = 'admin' where email = 'THE_ADMIN_EMAIL';
```

That user must **sign out and sign back in** so the JWT picks up `app_metadata.app_role`. Do not set `role` from the client.

---

## RevenueCat webhook

1. Create a RevenueCat project; entitlement id `premium`.
2. Webhook URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook`
3. Authorization header must match `REVENUECAT_WEBHOOK_AUTH`.
4. Set RevenueCat `app_user_id` = Supabase Auth user UUID so entitlements map correctly.
5. Each event must include a stable `event.id` (UUID) and `event_timestamp_ms`.
6. Behaviour:
   - Duplicate `event.id` → `200` `{ data: { duplicate: true } }` (no double-apply)
   - Older than last applied event → ledger kept, entitlement unchanged → `200` `{ data: { stale: true } }`
   - Unknown / non-UUID `app_user_id` → `400`
   - Applied updates go through `apply_revenuecat_entitlement()` (race-safe)

---

## Verify everything

```sql
-- Catalog
select count(*) from books where is_published;

-- Search
select title
from books
where search_vector @@ plainto_tsquery('english', 'prayer');

-- Premium helper
select public.user_has_active_premium('00000000-0000-0000-0000-000000000000');
```

Invoke signed PDF (after login + upload):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/get-signed-pdf" \
  -H "Authorization: Bearer USER_JWT" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"bookId":"33333333-3333-3333-3333-333333333001"}'
```
