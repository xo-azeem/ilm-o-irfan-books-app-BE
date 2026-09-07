# Ilm o Irfan Backend — Work Progress Report

**Repo:** `D:\ilm-o-irfan-books-app-BE`  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Branch (working):** `feat/mobile-api-parity`  
**Report started:** 2026-08-31  
**Last updated:** 2026-09-07 (optional polish: e2e failure modes, import rules, media budgets)

This file tracks work done in the “absolute beast backend” stream.  
Backlog: [`backend-beast-roadmap.md`](./backend-beast-roadmap.md) · Audit: [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md)

**Hosted status:** Staging `rwnmckrepvycydmtgvcq` live — migrations, seed, Edge Functions, secrets, `smoke:hosted` + `smoke:covers` + `smoke:failures` green. Auth Email on; seed admin/test; catalog + sample PDFs. Still open externally: RevenueCat live webhook, Google OAuth, custom SMTP, production twin, merge/tag.

---

## How to read this report

| Status | Meaning |
| --- | --- |
| Done | Completed and verified in-repo |
| Blocked | Cannot finish without you / external dependency |
| Skipped for now | Intentionally deferred while doing unblocked work |
| Next | Immediate next step |

---

## What is NOT happening (by me) — and why

| Item | Why it is not happening |
| --- | --- |
| Local `supabase start` / `db reset` / `npm run test:e2e` | **Docker is not installed** (`docker` command missing) |
| Uploading real book PDFs/covers via `books:import` | **No `BOOKS_DIR`** on disk yet — see [`ops/books-ingest.md`](./ops/books-ingest.md) |
| Creating production Supabase project | Requires your Supabase Dashboard account |
| Google OAuth / App Store / Play / RevenueCat live projects | Dashboard + store credentials — ops on your side |
| Wiring the React Native app to Supabase/RC | FE work in `D:\ilm-o-irfan-books-app` (out of this BE pass unless you ask) |
| Merging to `main` / deleting stale remote branches | Ops decision — not done without your explicit ask |
| First admin promote | Needs you to enable Email Auth + sign up, then SQL (§F) |

**Unblocked work continued anyway** (below): seed shelves, import script, home-feed/library/profile APIs, streak lock, admin CMS Edge Function wrappers, docs.

---

## Session overview

1. Mapped repo + branches (`main` docs-only; product tip on `dev` / `feat/app-optimization`).
2. §1 doc/path/env hygiene.
3. §2 hosted prep + free-book PDF fix (deploy blocked).
4. Audit #2 RevenueCat webhook idempotency.
5. §4 content pipeline + API polish — skipped waiting on project ref per your request.
6. §5 admin CMS Edge Function wrappers + `highlights-delete`.
7. §6 unblocked options: CI scaffolding, `admin-book-create` / authors CRUD, FE fixtures.
8. §7 release hardening: audit fixes, CMS completion, unit tests, CI, runbooks (this update).

---

## Phase 0 — Project understanding (Done)

See earlier branch map: product backend lives on `feat/app-optimization` / `dev`, not `main`.

---

## Phase 1 — Doc / path / env hygiene (Done)

- FE/BE paths corrected; `.env.example` paywall default `false`; setup-guide + README honesty; empty migration commented.

---

## Phase 2 — Hosted infrastructure (Prep Done / Deploy Blocked)

| Done in-repo | Blocked |
| --- | --- |
| `docs/ops/deploy-checklist.md` | Project create + ref |
| `link` / `functions:deploy` / `functions:list` scripts | CLI login + link |
| Free-book fix in `get-signed-pdf` | Live smoke on hosted |
| Paywall-safe examples | Setting real secrets |

---

## Phase 3 — RevenueCat webhook idempotency (Done in-repo)

- Migration `20260831140000_…` + `apply_revenuecat_entitlement()` + hardened webhook EF.
- Live RC sandbox matrix still blocked until hosted + RC project exist.

---

## Phase 4 — Content pipeline + API polish (Done in-repo this turn)

### 4.1 Seed collections (Done)

| Change | Detail |
| --- | --- |
| `supabase/seed.sql` | Inserts `home-hero`, `trending`, `new-arrivals`, `beginners-path`, `ramadan-reading`; sets `app_settings.featured_collection_id` → hero when null |
| `sql/pgadmin/02_seed.sql` | Same collection + featured update |

**Not run against a live DB** — Docker missing / no project (see table above).

### 4.2 Import script hardened (Done)

| Change | Detail |
| --- | --- |
| `scripts/import-folder-books.mjs` | Requires `BOOKS_DIR` (or discovers known paths); clear error if missing |
| | Ensures collection rows before membership (`home-hero` / `trending` / `new-arrivals`) |
| | Default category `spirituality` (seeded) instead of silent broken `literature`-only joins |
| | `meta.json` supports `isPremium` / `categorySlug` / `genre`; `DEFAULT_IS_PREMIUM` env |
| | `DRY_RUN=1` / `SQL_ONLY=1` writes SQL without upload |
| | Joins all three required shelves |

**Not executed end-to-end** — no books folder and no `.env` / linked project.

### 4.3 API polish (Done)

| Endpoint / area | Change |
| --- | --- |
| `home-feed` | Adds `featuredCollectionId` + `shelves.{hero,trending,newArrivals}` (falls back to newest books if shelves empty) |
| `profile-update` | `date_of_birth` editable (`YYYY-MM-DD`) |
| `profile-read` | Includes `streak`; GET-only enforced; 404 if no profile |
| `library-overview` | Adds `finished` (`progress >= 0.99`) + `highlights`; in-progress excludes finished |
| Migration `20260831150000_lock_reading_streaks.sql` | Clients SELECT-only on streaks; trigger still updates |
| Docs | setup-guide, schema, api-endpoints updated |

### 4.4 Content upload / publish / storage audit (Blocked)

Cannot upload PDFs or run `admin_storage_audit()` against a live project without hosted/local stack + book files.

---

## Phase 5 — Admin CMS Edge Function wrappers (Done in-repo)

Wrapped existing SQL RPCs so day-to-day CMS work does not need raw SQL. All use `ctx.supabase` (user JWT) so `is_admin()` works — same pattern as `admin-analytics`.

| Function | RPC / behavior |
| --- | --- |
| `admin-book-delete` | `admin_delete_books` |
| `admin-bulk-update-books` | `admin_bulk_update_books` |
| `admin-set-book-relations` | `admin_set_book_relations` (preserves omitted side) |
| `admin-set-collection-books` | `admin_set_collection_books` |
| `admin-reorder` | `admin_reorder` |
| `admin-set-entitlement` | `admin_set_entitlement` |
| `admin-set-user-role` | `admin_set_user_role` |
| `admin-user-detail` | `admin_user_detail` |
| `admin-storage-audit` | `admin_storage_audit` |
| `admin-delete-storage-object` | `admin_delete_storage_object` |
| `admin-dashboard-stats` | `admin_dashboard_stats` |
| `highlights-delete` | Direct RLS delete for current user |

Also: `config.toml` `verify_jwt = true`, `endpoint-manifest.ts`, `api-endpoints.md`, setup-guide deploy list, deploy-checklist inventory.

**Closed in Phase 7:** category / collection / plan write EFs, so nothing in day-to-day CMS work needs raw SQL any more.

**Not deployed** — still blocked on project ref.

---

## Phase 6 — CI + create/authors + FE fixtures (Done in-repo)

| Item | Detail |
| --- | --- |
| `admin-book-create` | POST create book; slug from title; publish requires `pdf_path` |
| `admin-authors` | GET list via `admin_author_rows` |
| `admin-author-create` / `update` / `delete` | CRUD; delete blocked if books remain |
| `scripts/ci-static-check.mjs` | Folders ↔ config.toml ↔ manifest ↔ fixtures |
| `.github/workflows/static-checks.yml` | Runs `npm run ci:static` on push/PR (no Docker) |
| `docs/fixtures/*` | home-feed, book-detail, entitlements, signed-pdf, library, profile |
| `npm run ci:static` | **Verified locally — all checks passed** |

**Still blocked / not in CI:**

| Item | Why |
| --- | --- |
| `npm run test:e2e` in GitHub Actions | Needs Docker + local Supabase; workflow only notes skip |
| Deploy workflow | Needs project secrets / OIDC to Supabase — not added without your credentials |
| Live fixture regen from hosted | Needs project |

---

## Phase 7 — Release hardening + CMS completion (Done in-repo, 2026-09-05)

Closes every remaining item in the audit and every code item in the roadmap.

### 7.1 Migration `20260905120000_release_hardening.sql` (+ pgAdmin `11_…`)

| Area | Change |
| --- | --- |
| Storage-aware publishing | `storage_object_key()`, `storage_object_exists()`, `book_publish_blocker()`; `admin_bulk_update_books` now returns `skippedBooks: [{ id, reason }]` |
| Reading progress | `upsert_reading_progress()` — atomic partial merge; null keeps a column, `''` clears the chapter |
| Search limits | `search_books()` clamps limit to 1–100 and offset to 0–10,000 inside the function |
| Audit attribution | `private.audit_write()` reads `x-audit-actor-*` on service-role requests, so CMS writes stop being logged as `system` |
| Category / collection / plan CRUD | `admin_upsert_*` and `admin_delete_*` with reference guards and a `force` override |
| `admin_plan_rows` | Admin view including inactive plans + entitlement counts |
| Indexes | `entitlements(plan_id)`, `book_categories(category_id)`, `collection_books(book_id)` — unindexed FKs the new guards scan |

### 7.2 HTTP contract hardening

| Change | Detail |
| --- | --- |
| Method enforcement | 16 read endpoints had no `requireMethod` guard and would answer any verb; all now enforce |
| Error tails | `handleError()` added to `_shared/http.ts` and adopted by all 45 pre-existing functions, so no handler can drop the `BadRequestError` branch |
| Pagination ceiling | `rangeFromRequest()` rejects offsets past 10,000 rows with `400 PAGE_OUT_OF_RANGE` |
| Publish gate | `admin-book-create` / `admin-book-update` verify the PDF object before going live |
| Downloads | Documented as telemetry; book visibility now checked through RLS, reported size capped |
| Reading progress | Partial writes stopped resetting `current_page` / `chapter_label` |
| Audit headers | `requireAdmin()` forwards the verified caller to the audit trigger |

### 7.3 New Edge Functions (12)

| Function | Purpose |
| --- | --- |
| `avatar-upload-url` | One-shot signed upload URL under `{user_id}/…`; `profile-read` now returns a signed `avatarUrl` |
| `admin-category-create` / `-update` / `-delete` | Category CMS without SQL |
| `admin-collection-create` / `-update` / `-delete` | Collection CMS; refuses to delete the featured shelf |
| `admin-plans`, `admin-plan-create` / `-update` / `-delete` | Plan CMS including inactive plans |
| `admin-audit-log` | "Who published X" — filter by entity, actor, action, date |

Total Edge Functions: **57**.

### 7.4 Tests + CI

| Item | Detail |
| --- | --- |
| `tests/` | 60+ Deno unit tests: pagination, payload validation, response envelopes, progress scale, webhook state machine |
| `_shared/progress.ts`, `_shared/revenuecat.ts` | Logic extracted from the handlers so it is testable without a database |
| `_shared/publishing.ts`, `_shared/rpc.ts` | Publish gate and Postgres-error → HTTP mapping, shared |
| `scripts/ci-static-check.mjs` | Now also checks method enforcement, manifest/handler agreement, migration ordering, and scans for committed secrets |
| `.github/workflows/static-checks.yml` | Two jobs: Node contract checks, and `deno check` / `lint` / `test` |
| `deno.json`, npm scripts | `test:unit`, `typecheck`, `lint`, `fmt:check`, `ci` |
| `scripts/e2e-endpoints.sh` | Local keys read from `supabase status` instead of a pinned copy that newer CLI versions invalidate |

**Verified locally:** `npm run ci:static` — all checks pass. `test:unit` / `typecheck` need
Deno, which is not installed on this machine; they run in CI.

### 7.5 Docs

| Item | Detail |
| --- | --- |
| `docs/runbooks/` | paywall-open, webhook-down, storage-miss, auth-failures, secret-rotation |
| `docs/ops/env-matrix.md` | Local / staging / production, every secret, what leaking each costs |
| `docs/fixtures/` | Added reading-progress, avatar-upload-url, admin-audit-log, page-out-of-range; contract notes for the app team |
| `docs/api-endpoints.md` | New endpoints, new error codes, publish rules, merge semantics, pagination ceiling |
| `docs/schema.md` | Full release-hardening section |
| `docs/setup-guide.md`, `docs/ops/deploy-checklist.md`, `README.md` | Migration and deploy lists, new smoke checks, script inventory |

---

## Phase 8 — Hosted sync (2026-09-05, re-verify required)

A prior session applied migrations through `fix_last_admin_guard` and deployed functions when
credentials were present in `.env`. That does **not** replace a current checklist §G sign-off.

**As of 2026-09-06:** the ship-ready path is `npm run deploy:hosted` + `npm run smoke:hosted`
([`ops/deploy-checklist.md`](./ops/deploy-checklist.md)). Re-run against staging before calling
hosted “verified.” Later migrations (e.g. `restrict_covers_listing`) and `collection-books` /
`coverUrl` work on `feat/mobile-api-parity` must be included in that re-deploy.

### 8.1 Migrations (historical note)

The remote ledger was healthy and in sync through `20260831130000` — no repair needed. Four
migrations were pending on **both** databases, and the same set was applied to each:

| Migration | Remote | Local |
| --- | --- | --- |
| `20260831140000_revenuecat_events_idempotency` | applied | applied |
| `20260831150000_lock_reading_streaks` | applied | applied |
| `20260905120000_release_hardening` | applied | applied |
| `20260905130000_fix_last_admin_guard` | applied | applied |

Local was brought up with `supabase start` and migrated with `db push` rather than
`db reset`, so existing local data survived.

**Parity verified** by fingerprint, not by assumption: table/column shapes and function
signatures hash identically, and function bodies match once line endings are normalised
(local stores CRLF, remote LF — cosmetic, from the Windows checkout).

### 8.2 Two real bugs found by running the suite

Neither was introduced this session; both were pre-existing and both reached the app.

**`PGRST103` — every list endpoint 500s at the end of an infinite scroll.**
PostgREST answers a `Range` that starts past the last row with 416, not an empty body. That
is the final call of every "load more" loop, so the app got
`500 BOOKS_READ_FAILED` the moment a user scrolled to the bottom of any list. Fixed in
`_shared/pagination.ts` (`isRangeNotSatisfiable`) and applied to all 14 paginated endpoints,
which now return the empty tail page.

**The last-admin guard never fired.**
`admin_set_user_role()` declared its local variable as `current_role`, a reserved SQL
keyword that Postgres resolves to the session role inside the function body. Both guards
reading it were dead code: the last admin could be demoted, locking everyone out of the CMS,
and setting a role on a non-existent user reported success. Fixed in
`20260905130000`; the endpoint now returns `409 LAST_ADMIN`. Grepped the rest of the
migrations for the same class of mistake — this was the only instance.

### 8.3 E2E

`npm run test:e2e` now runs for real against the local stack: **131 assertions, 0 failures**,
including the publish gate, the progress merge, the pagination ceiling, audit attribution,
the RLS regression block, and the corrected last-admin guard.

### 8.4 Remote deployment and data

| Item | State |
| --- | --- |
| Edge Functions | All 57 deployed; the remote set was stale (nothing since before Phase 5) |
| Catalog | 18 authors, 20 books, all 20 published, **all with their PDF present in Storage** |
| Collections | Were zero; the five canonical shelves seeded from `seed.sql`, `featured_collection_id` pointed at `home-hero`. Rows only — no membership yet |
| Premium books | Zero, so the paywall is not yet exercised in production |
| RLS | Every public table has it enabled; no `SECURITY DEFINER` function is missing a pinned `search_path` |

---

## Audit alignment

| Item | Status |
| --- | --- |
| #1 PDF free-book auth | **Fixed** |
| #2 Webhook idempotency | **Fixed in-repo** (sandbox after deploy) |
| #3 Migration docs | **Fixed**; live push needs project |
| #4 Paywall defaults | **Fixed** — the flag is gone from the code, not merely defaulted off |
| HTTP contracts | **Fixed** — enforced and CI-checked |
| Reading progress integrity | **Fixed** — atomic partial merge |
| Publishing / Storage integrity | **Fixed** — publish verifies the object exists |
| Search RPC limits | **Fixed** — clamped in SQL |
| Pagination scale | **Fixed** — offset ceiling |
| Download records | **Decided** — telemetry, documented |
| Automated verification | **Fixed** — unit tests + CI |

---

## Files touched (cumulative highlights)

### Created

- `docs/backend-beast-roadmap.md`, `docs/ops/deploy-checklist.md`, `docs/backend-work-progress.md`
- `supabase/migrations/20260905120000_release_hardening.sql`, `sql/pgadmin/11_release_hardening.sql`
- `supabase/functions/_shared/{progress,publishing,revenuecat,rpc}.ts`
- `supabase/functions/avatar-upload-url`, `admin-audit-log`, `admin-plans`, and the category / collection / plan CRUD functions
- `tests/{pagination,payload,http,progress,revenuecat}_test.ts`, `deno.json`
- `docs/runbooks/` (5 runbooks + index), `docs/ops/env-matrix.md`
- `supabase/migrations/20260831140000_revenuecat_events_idempotency.sql`
- `supabase/migrations/20260831150000_lock_reading_streaks.sql`
- `sql/pgadmin/09_revenuecat_events_idempotency.sql`, `10_lock_reading_streaks.sql`

### Updated (this + prior)

- Seed / import / get-signed-pdf / revenuecat-webhook / home-feed / profile-* / library-overview / payload helper / Cursor rules / README / `.env.example` / setup-guide / schema / api-endpoints / audit / package.json

---

## Next actions

| # | Action | Owner | Blocker |
| --- | --- | --- | --- |
| 1 | RevenueCat project + real webhook secret + sandbox matrix | You | Dashboard — `ops/staging-billing-auth.md` |
| 2 | Google OAuth + RN deep-link scheme | You | Google Cloud + Dashboard |
| 3 | Custom SMTP (branded mail / email rate limits) | You | SMTP provider |
| 4 | Production project + merge/tag | You | Explicit ask |

**Staging ready:** covers HTTP 200, PDF gates, auth URIs, admin/test users, catalog audit clean.

---

## Definition of done snapshots

### §2 Hosted — not done until

- [x] Project linked, migrations applied, all EFs deployed, paywall closed, smoke OK
- [x] Admin promoted (seed `admin@gmail.com` + verified JWT)
- [x] Confirmations On for Email Auth

### §4 Content — code done; data not done until

- [x] Seed applied on staging DB  
- [x] Real books imported + Storage objects present (staging)  
- [x] `admin_storage_audit()` clean  
- [x] `home-feed.shelves` can return membership (catalog present; sample books joined to shelves)
