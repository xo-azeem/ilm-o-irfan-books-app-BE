# Ilm o Irfan Backend — Work Progress Report

**Repo:** `D:\ilm-o-irfan-books-app-BE`  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Branch (working):** `feat/app-optimization`  
**Report started:** 2026-08-31  
**Last updated:** 2026-08-31 (CI + admin create/authors + FE fixtures; hosted still blocked)

This file tracks work done in the “absolute beast backend” stream.  
Backlog: [`backend-beast-roadmap.md`](./backend-beast-roadmap.md) · Audit: [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md)

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
| `supabase link` / `db push` / `functions:deploy` to hosted | **No Supabase project ref** and no `.supabase/project-ref` or `.env` on this machine |
| Local `supabase start` / `db reset` / `npm run test:e2e` | **Docker is not installed** (`docker` command missing) |
| Uploading real book PDFs/covers via `books:import` | **No `BOOKS_DIR`** on disk (`D:/Books`, `D:/Projects/Books`, etc. all missing) and no linked project / `.env` with service role |
| Creating staging/production Supabase projects | Requires your Supabase Dashboard account |
| Google OAuth / App Store / Play / RevenueCat live projects | Dashboard + store credentials — ops on your side |
| Wiring the React Native app to Supabase/RC | FE work in `D:\ilm-o-irfan-books-app` (out of this BE pass unless you ask) |
| Merging to `main` / deleting stale remote branches | Ops decision — not done without your explicit ask |
| Regenerating `types/database.ts` from hosted schema | Needs linked project after migrations are pushed |

**Unblocked work continued anyway** (below): seed shelves, import script, home-feed/library/profile APIs, streak lock, admin CMS Edge Function wrappers, docs.

---

## Session overview

1. Mapped repo + branches (`main` docs-only; product tip on `dev` / `feat/app-optimization`).
2. §1 doc/path/env hygiene.
3. §2 hosted prep + free-book PDF fix (deploy blocked).
4. Audit #2 RevenueCat webhook idempotency.
5. §4 content pipeline + API polish — skipped waiting on project ref per your request.
6. §5 admin CMS Edge Function wrappers + `highlights-delete`.
7. §6 unblocked options: CI scaffolding, `admin-book-create` / authors CRUD, FE fixtures (this update).

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

**Still not present (intentionally later):** category/collection write EFs beyond reorder/membership (create category/collection rows still via SQL/Dashboard if needed).

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

## Audit alignment

| Blocker | Status |
| --- | --- |
| #1 PDF free-book auth | **Fixed** |
| #2 Webhook idempotency | **Fixed in-repo** (sandbox after deploy) |
| #3 Migration docs | **Fixed**; live push needs project |
| #4 Paywall defaults | **Fixed** |

---

## Files touched (cumulative highlights)

### Created

- `docs/backend-beast-roadmap.md`, `docs/ops/deploy-checklist.md`, `docs/backend-work-progress.md`
- `supabase/migrations/20260831140000_revenuecat_events_idempotency.sql`
- `supabase/migrations/20260831150000_lock_reading_streaks.sql`
- `sql/pgadmin/09_revenuecat_events_idempotency.sql`, `10_lock_reading_streaks.sql`

### Updated (this + prior)

- Seed / import / get-signed-pdf / revenuecat-webhook / home-feed / profile-* / library-overview / payload helper / Cursor rules / README / `.env.example` / setup-guide / schema / api-endpoints / audit / package.json

---

## Next actions

| # | Action | Owner | Blocker |
| --- | --- | --- | --- |
| 1 | Create Supabase project + send **project ref** | You | — |
| 2 | Provide / place books under `BOOKS_DIR` | You | No books folder found |
| 3 | Install Docker (optional local Path C + e2e) | You | Docker missing |
| 4 | link → `db:push` → deploy EFs → secrets → smoke | Agent | Needs #1 |
| 5 | `BOOKS_DIR=… npm run books:import` then storage audit | Agent | Needs #1 + #2 |
| 6 | Google OAuth + RC sandbox | You + agent | Dashboards |
| 7 | FE wiring to Supabase/RC | FE repo | Optional parallel track |
| 8 | Deploy workflow with secrets | Agent | Needs your Supabase CI credentials |

---

## Definition of done snapshots

### §2 Hosted — not done until

- [ ] Project linked, migrations applied (incl. RC events + streak lock), all EFs deployed, paywall closed, admin promoted, smoke OK

### §4 Content — code done; data not done until

- [ ] Seed applied on target DB  
- [ ] Real books imported + Storage objects present  
- [ ] `admin_storage_audit()` clean  
- [ ] `home-feed.shelves` returns real membership (not only newest fallback)
