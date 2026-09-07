# Ilm o Irfan — Backend

Supabase + PostgreSQL backend for the **Ilm o Irfan** React Native e-book app.

## Companion frontend

`D:\ilm-o-irfan-books-app`

## Stack

| Layer | Technology |
| --- | --- |
| Platform | Supabase |
| Database | PostgreSQL |
| Auth | Supabase Auth (email; Google when enabled in Dashboard) |
| Files | Storage buckets `covers`, `pdfs`, `avatars` |
| Privileged logic | Edge Functions |
| Subscriptions | RevenueCat → webhook → `entitlements` |

Design & cost notes: [`docs/backend-stack.md`](docs/backend-stack.md)  
Schema reference: [`docs/schema.md`](docs/schema.md)  
**Mobile contract (FE team):** [`docs/mobile-contract.md`](docs/mobile-contract.md)  
**FE/BE parity audit:** [`docs/audits/2026-09-06-fe-be-parity.md`](docs/audits/2026-09-06-fe-be-parity.md)  
**Setup + pgAdmin steps:** [`docs/setup-guide.md`](docs/setup-guide.md)  
**Beast backlog:** [`docs/backend-beast-roadmap.md`](docs/backend-beast-roadmap.md)  
**Work progress report:** [`docs/backend-work-progress.md`](docs/backend-work-progress.md)  
**FE fixtures:** [`docs/fixtures/`](docs/fixtures/)  
**Runbooks:** [`docs/runbooks/`](docs/runbooks/)  
**Env matrix:** [`docs/ops/env-matrix.md`](docs/ops/env-matrix.md)  
**Deploy checklist:** [`docs/ops/deploy-checklist.md`](docs/ops/deploy-checklist.md)  
**Book ingest:** [`docs/ops/books-ingest.md`](docs/ops/books-ingest.md)  
**Staging RC / Google:** [`docs/ops/staging-billing-auth.md`](docs/ops/staging-billing-auth.md)  
**Catalog environments:** [`docs/ops/catalog-environments.md`](docs/ops/catalog-environments.md)  
**FE handoff:** [`docs/ops/fe-handoff.md`](docs/ops/fe-handoff.md)

## Repo layout

```text
supabase/
  migrations/     # schema, RLS, storage
  functions/      # catalog, user, admin, PDF, and webhook Edge Functions
  seed.sql        # baseline categories + plan
sql/pgadmin/      # run in pgAdmin Query Tool
docs/             # stack, schema, setup
```

## Deploy staging (one pass)

1. Create a Supabase project; copy the project ref.
2. `npx supabase login` (or set `SUPABASE_ACCESS_TOKEN`).
3. Put in `.env`: `SUPABASE_PROJECT_REF`, `REVENUECAT_WEBHOOK_AUTH` (or use `DEPLOY_ALLOW_PLACEHOLDER_RC=1`), `REVENUECAT_ENTITLEMENT_ID=premium`, `SIGNED_PDF_EXPIRES_IN=300`, plus `SUPABASE_URL` / anon key for smoke.
4. `DEPLOY_SEED=1 npm run deploy:hosted`
5. `npm run smoke:hosted`
6. Enable Email Auth; promote first admin; give FE URL + anon key ([`docs/ops/fe-handoff.md`](docs/ops/fe-handoff.md)).

Details: [`docs/ops/deploy-checklist.md`](docs/ops/deploy-checklist.md).  
Path A walkthrough: [`docs/setup-guide.md`](docs/setup-guide.md).

### Local schema-only (pgAdmin)

If you only want to browse tables on a local Postgres install:

1. Create database `ilm_o_irfan` in pgAdmin.
2. Run `sql/pgadmin/01_full_schema.sql`, then `sql/pgadmin/02_seed.sql`.

Full click-by-click instructions are in the setup guide.

## Scripts

```bash
npm install
npm run supabase:start       # local Docker stack
npm run supabase:stop
npm run db:reset             # local: migrations + seed
npm run db:push              # push migrations to the linked project
npm run link                 # supabase link --project-ref … (interactive)
npm run deploy:hosted        # one-pass: link → push → functions → secrets
npm run smoke:hosted         # public EF smoke against SUPABASE_URL
npm run smoke:rls            # RLS / paywall regression against hosted project
npm run types:generate       # types from the linked project (run AFTER db:push)
npm run types:generate:local # types from the local Docker stack instead
npm run functions:serve      # local functions (needs Docker + supabase start)
npm run functions:deploy     # deploy all Edge Functions to linked project
npm run functions:list       # list deployed functions
npm run books:import         # BOOKS_DIR=… (or fixtures/sample-books); DRY_RUN=1 supported
npm run books:sample         # write fixtures/sample-books tiny PDF+cover pack
npm run smoke:pdf            # free/premium/admin PDF gates + PREMIUM_REQUIRED
npm run smoke:covers         # HEAD/GET public coverUrl from home-feed
npm run test:e2e             # bash e2e against local stack (Git Bash / WSL on Windows)
npm run test:unit            # Deno unit tests for the shared helpers (no Docker)
npm run typecheck            # deno check across every function
npm run lint                 # deno lint
npm run ci:static            # contracts, method enforcement, fixtures, secret scan (no Docker)
npm run ci                   # everything CI runs, in order
```

Only `test:e2e`, `functions:serve`, `supabase:start` and `db:reset` need Docker.
`test:unit`, `typecheck` and `lint` need [Deno](https://deno.com) on PATH; `ci:static`
runs on Node alone. `deploy:hosted` / `smoke:hosted` need a real project (no Docker).

API response fixtures for the FE: [`docs/fixtures/`](docs/fixtures/).  
Full hosted steps: [`docs/ops/deploy-checklist.md`](docs/ops/deploy-checklist.md).  
Environment matrix: [`docs/ops/env-matrix.md`](docs/ops/env-matrix.md).  
When something breaks: [`docs/runbooks/`](docs/runbooks/).

`types:generate` needs CLI auth — `npx supabase login` once, or set `SUPABASE_ACCESS_TOKEN`.
Only the `:local` / `supabase:start` / `test:e2e` paths need Docker. Always push migrations before regenerating, or the
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

`profile-update`, `admin-settings`, `admin-book-update`, `highlights-upsert`,
`reading-progress`, and the category / collection / plan update endpoints only write the
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
- Use `coverUrl` on book cards; do not invent Storage public URLs on the client.
- Filter Search by category with `GET books-list?category=<uuid-or-slug>`.
- Collection detail: `GET collection-books?id=` or `?slug=`.

Mobile contract: [`docs/mobile-contract.md`](docs/mobile-contract.md).

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

There is a ceiling. Offset pagination reads and discards every preceding row, so an offset
past 10,000 rows is answered with `400 PAGE_OUT_OF_RANGE` rather than a table scan. Nothing
in the product needs to reach past it; a client that does is looping or scraping. Search is
clamped in the database as well — `search_books()` bounds its own limit and offset, because
the RPC is reachable directly through the Data API and not only through the Edge Function.

Ordering always includes `id` as a final tiebreaker so a row cannot appear on two pages when
the primary sort key ties or is null.

The shared helper lives in `supabase/functions/_shared/pagination.ts`. For very large offsets,
`buildCursorPagination` in the same file supports cursor-style paging with a stable sort key,
which avoids the cost of a deep `OFFSET` scan.

## Implemented backend phases

The backend is now structured in functional phases for the app's real product flows.

### Public catalog phase

Included endpoints:

- `GET /functions/v1/books-list` — paginated list of published books (`?category=` optional)
- `GET /functions/v1/book-detail?id=<bookId>` — single book detail lookup
- `GET /functions/v1/books-search?q=<query>` — full-text search over title, author name,
  description, genre and tags, ranked by relevance
- `GET /functions/v1/categories-list` — category list with counts
- `GET /functions/v1/collections-list` — collection and shelf summaries
- `GET /functions/v1/collection-books?id=` or `?slug=` — books in one collection
- `GET /functions/v1/plans-list` — active premium plans
- `GET /functions/v1/home-feed` — home feed with collections, categories, and featured books

Catalog and library book cards include a computed `coverUrl`. Full field map:
[`docs/mobile-contract.md`](docs/mobile-contract.md).

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
- `POST /functions/v1/avatar-upload-url`

These are protected by authenticated access and user-scoped data queries.

### Admin phase

Included endpoints:

- `GET /functions/v1/admin-books` / `PATCH /functions/v1/admin-book-update`
- `GET /functions/v1/admin-users`
- `GET /functions/v1/admin-analytics`
- `GET /functions/v1/admin-categories`
- `GET /functions/v1/admin-collections`
- `GET /functions/v1/admin-settings` / `PATCH /functions/v1/admin-settings`
- Author, category, collection and plan CRUD (`admin-*-create` / `-update` / `-delete`)
- `GET /functions/v1/admin-plans` — includes inactive plans, unlike public `plans-list`
- `GET /functions/v1/admin-audit-log` — who changed what, filterable by entity and actor

These endpoints enforce admin checks and use service-role access for privileged backend
operations. The full inventory, with methods, is
[`supabase/functions/_shared/endpoint-manifest.ts`](supabase/functions/_shared/endpoint-manifest.ts).

Day-to-day CMS work needs no raw SQL: every admin RPC has an Edge Function in front of it,
and each write is attributed to the admin who made it in `admin_audit_log`.

## Security rules (non-negotiable)

- PDF/cover **bytes** live in Storage — never in Postgres.
- Clients never write `entitlements` — webhook / service role only.
- Signed PDF URLs come from `get-signed-pdf` after auth + premium checks.
