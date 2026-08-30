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

## API contract

Every endpoint returns one of three shapes. The app should have exactly one parser and one
error handler.

```jsonc
// single object
{ "data": { /* ... */ } }

// list (see the pagination contract below)
{ "data": [ /* ... */ ], "page": 1, "pageSize": 20, "totalCount": 121,
  "totalPages": 7, "hasNextPage": true, "hasPreviousPage": false }

// failure — ALWAYS this shape, on every status
{ "error": { "code": "PREMIUM_REQUIRED", "message": "Active subscription required" } }
```

Branch on `error.code`, never on `error.message` — messages are for logs and may be reworded.
Raw Postgres errors are never returned to the client; they are logged server-side and reported
as a stable code.

Codes shared by every endpoint: `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `INVALID_REQUEST`
(400), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `UNEXPECTED_ERROR` (500). Endpoints add
their own, e.g. `PREMIUM_REQUIRED`, `PDF_NOT_IN_STORAGE`, `DEPRECATED_ENDPOINT`.

### Partial updates

`profile-update`, `admin-settings`, `admin-book-update` and `highlights-upsert` only write the
fields present in the request body. Sending `{ "full_name": "..." }` leaves the address alone.
To clear a field, send it explicitly as `null`. An empty body is a 400, not a silent no-op.

### Reading progress scale

`reading_progress.progress` is a fraction between 0 and 1. Send **either**:

- `progress` — `0.0` to `1.0`, or
- `progress_percent` — `0` to `100`

Sending both, or a value out of range, is a 400. There is no auto-detection: `1` is genuinely
ambiguous between "finished" and "1% read", and guessing it wrong marks a book complete for a
reader one page in.

### Notes for the app team

- `wishlist-list` and `downloads-list` return the joined book under `book`, not `books`, and
  carry only card-sized fields. Call `book-detail` for the full record.
- `library-overview` returns `{ items, totalCount, hasMore }` per shelf, capped at `limit`
  (default 20, max 50). Page through `wishlist-list` / `downloads-list` / `reading-progress`
  for the full lists.
- `entitlements-status` returns `{ isActive, isAdmin, canAccessPremium, entitlement }`.
  **Gate premium UI on `canAccessPremium`, not `isActive`.** `isActive` is a truthful report
  of the subscription alone, and admins have no subscription — but `get-signed-pdf` serves
  them any PDF regardless. Gating on `isActive` would show an admin a locked button on a file
  the backend would hand over.
- `POST /functions/v1/signed-pdf` is gone; it answers 410. Use `get-signed-pdf`.

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

Every list endpoint uses this envelope: `books-list`, `books-search`, `categories-list`,
`collections-list`, `wishlist-list`, `downloads-list`, `highlights-list`, `reading-progress`
(GET), and all four admin list endpoints. `plans-list` is the one exception — a plan catalogue
is a handful of rows, so it returns the plain `{ data: [...] }` shape.

Requests are clamped server-side: `pageSize` is capped at 100, and a non-numeric or negative
`page` falls back to 1 rather than erroring. `page` beyond the last page returns an empty
`data` array with the real `totalCount`, not a 404.

Ordering always includes `id` as a final tiebreaker so a row cannot appear on two pages when
the primary sort key ties or is null.

The shared helper lives in `supabase/functions/_shared/pagination.ts`. For very large offsets,
`buildCursorPagination` in the same file supports cursor-style paging with a stable sort key,
which avoids the cost of a deep `OFFSET` scan.

## Implemented backend phases

The backend is now structured in functional phases for the app's real product flows.

### Public catalog phase

Included endpoints:

- `GET /functions/v1/books-list` — paginated list of published books
- `GET /functions/v1/book-detail?id=<bookId>` — single book detail lookup
- `GET /functions/v1/books-search?q=<query>` — full-text search over title, author name,
  description, genre and tags, ranked by relevance
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
