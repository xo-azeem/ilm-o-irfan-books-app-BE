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
  functions/      # catalog, user, admin, PDF, and webhook Edge Functions
  seed.sql        # baseline categories + plan
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
npm run db:push              # push migrations to the linked project
npm run types:generate       # types from the linked project (run AFTER db:push)
npm run types:generate:local # types from the local Docker stack instead
npm run functions:serve      # local functions (needs Docker + supabase start)
```

`types:generate` needs CLI auth — `npx supabase login` once, or set `SUPABASE_ACCESS_TOKEN`.
Only the `:local` variant needs Docker. Always push migrations before regenerating, or the
output will be missing whatever the new migration adds.

## Pagination contract

Pagination means breaking a large dataset into smaller chunks and sending only one chunk at a time to the user. This is how the app can show the first set of books immediately, then load the next set when the user scrolls down or presses Next.

Typical flow:

1. Request the first chunk: `page=1` and `pageSize=20`
2. Show the returned items to the user
3. When the user scrolls or requests more, send the next chunk: `page=2`, `page=3`, etc.
4. Repeat until the list is exhausted

Backend rules:

- Request parameters: `page` and `pageSize` (or `limit` as a compatible alias)
- Default: `page=1`, `pageSize=20`
- Maximum recommended page size: `100`
- Response shape:

```json
{
  "data": [],
  "page": 1,
  "pageSize": 20,
  "totalCount": 121,
  "totalPages": 7,
  "hasNextPage": true,
  "hasPreviousPage": false
}
```

This pattern is used for list APIs such as books, collections, categories, search results, and library screens. For large datasets, prefer cursor-based pagination with a stable sort key such as `created_at` + `id` to avoid expensive `OFFSET` scans. The shared helper lives in `supabase/functions/_shared/pagination.ts` and should be reused by all list endpoints.

## Implemented backend phases

The backend is now structured in functional phases for the app's real product flows.

### Public catalog phase

Included endpoints:

- `GET /functions/v1/books-list` — paginated list of published books
- `GET /functions/v1/book-detail?id=<bookId>` — single book detail lookup
- `GET /functions/v1/books-search?q=<query>` — full-text search by title, genre, or author
- `GET /functions/v1/categories-list` — category list with counts
- `GET /functions/v1/collections-list` — collection and shelf summaries
- `GET /functions/v1/plans-list` — active premium plans
- `GET /functions/v1/home-feed` — home feed with collections, categories, and featured books

These endpoints live under `supabase/functions/` and use the shared pagination helper for list responses.

### Authenticated user phase

Included endpoints:

- `GET /functions/v1/profile-read` / `PUT /functions/v1/profile-update`
- `GET /functions/v1/reading-progress` / `POST /functions/v1/reading-progress`
- `GET /functions/v1/wishlist-list` / `POST /functions/v1/wishlist-toggle`
- `GET /functions/v1/downloads-list` / `POST /functions/v1/downloads-create`
- `GET /functions/v1/highlights-list` / `POST /functions/v1/highlights-upsert`
- `GET /functions/v1/library-overview`
- `GET /functions/v1/entitlements-status`
- `POST /functions/v1/get-signed-pdf`

These are protected by authenticated access and user-scoped data queries.

### Admin phase

Included endpoints:

- `GET /functions/v1/admin-books` / `PATCH /functions/v1/admin-book-update`
- `GET /functions/v1/admin-users`
- `GET /functions/v1/admin-analytics`
- `GET /functions/v1/admin-categories`
- `GET /functions/v1/admin-collections`
- `GET /functions/v1/admin-settings` / `PATCH /functions/v1/admin-settings`

These endpoints enforce admin checks and use service-role access for privileged backend operations.

## Security rules (non-negotiable)

- PDF/cover **bytes** live in Storage — never in Postgres.
- Clients never write `entitlements` — webhook / service role only.
- Signed PDF URLs come from `get-signed-pdf` after auth + premium checks.
