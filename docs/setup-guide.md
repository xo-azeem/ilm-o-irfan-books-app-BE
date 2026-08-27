# Backend setup guide — Supabase + pgAdmin

This repo is the **Supabase** backend for Ilm o Irfan. PostgreSQL is the database engine *inside* Supabase — not a separate competing API.

## What you get in this repo

| Path | Purpose |
| --- | --- |
| `supabase/migrations/` | Production schema, RLS, storage buckets |
| `supabase/functions/` | `get-signed-pdf`, `revenuecat-webhook` |
| `supabase/seed.sql` | Baseline categories and subscription plan |
| `sql/pgadmin/` | Same schema/seed for running in pgAdmin Query Tool |
| `.env.example` | Keys / connection placeholders |

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
2. Paste and run, in order:
   - contents of `supabase/migrations/20260726120000_init_schema.sql`
   - contents of `supabase/migrations/20260726120100_rls_policies.sql`
   - contents of `supabase/migrations/20260726120200_storage_buckets.sql`
   - contents of `supabase/migrations/20260814114738_harden_grants_rls_indexes.sql`
   - contents of `supabase/migrations/20260814120331_harden_function_search_path.sql`
   - contents of `supabase/migrations/20260816194000_admin_roles_cms.sql`
   - contents of `supabase/seed.sql`

**Option 2b — CLI (best long-term)**

```bash
cd D:/Projects/Ilm-o-Irfan-App-BE
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase db query --file supabase/seed.sql
```

`YOUR_PROJECT_REF` is the subdomain in `https://YOUR_PROJECT_REF.supabase.co`.

### 3. Deploy Edge Functions

```bash
npx supabase functions deploy get-signed-pdf
npx supabase functions deploy revenuecat-webhook
```

Set secrets (Dashboard → Edge Functions → Secrets, or CLI):

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer your-shared-secret"
npx supabase secrets set REVENUECAT_ENTITLEMENT_ID="premium"
npx supabase secrets set SIGNED_PDF_EXPIRES_IN="300"
# Dev only — lets any signed-in user open PDFs without an entitlement.
# Also toggled from Admin → Overview ("Free PDF access") via app_settings.
# Unsafe for production. Leave unset or "false" before a public release.
npx supabase secrets set ALLOW_PDF_WITHOUT_ENTITLEMENT="true"
```

### 4. Auth providers

In Supabase **Authentication → Providers**:

- Enable **Email**
- Enable **Google** (add OAuth client ID/secret from Google Cloud Console)

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

1. Select database `ilm_o_irfan` → open **Query Tool**.
2. Open and execute `sql/pgadmin/01_full_schema.sql` (F5).
3. Open and execute `sql/pgadmin/02_seed.sql` (F5).
4. Refresh **Tables** — you should see catalog data.

Quick check:

```sql
select title, rating, is_premium from public.books order by rating desc;
select label, book_count from public.category_with_counts;
```

---

## Path C: Local Supabase via Docker (full local stack)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cd D:/Projects/Ilm-o-Irfan-App-BE
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
- they have an **active entitlement**

Admins may also preview unpublished drafts. Turn the switch and env **off** before a public release.

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
