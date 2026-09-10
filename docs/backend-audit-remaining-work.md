# Backend Audit: Remaining Work

**Opened:** 2026-08-31 · **Last updated:** 2026-09-07  
**Scope:** Supabase/PostgreSQL backend for the Ilm o Irfan mobile app  
**Status:** Code complete. Staging hosted deploy verified. Optional polish closed (e2e failure modes, import slug/size rules, media budgets, publish checklist).  
Remaining: RevenueCat live project, Google OAuth, custom SMTP, production twin, FE wiring.

## Executive Summary

The backend has the main catalog, user, admin, PDF, and RevenueCat webhook functions in place. Shared pagination, authentication helpers, response envelopes, database views, RLS policies, storage buckets, and admin authorization foundations are present.

The four release blockers — free-book PDF authorization, webhook replay and ordering,
migration documentation, and the production PDF bypass — are closed, as is every item under
High-Priority Hardening and Automated Verification. Nothing on this list is waiting on code.

What is still open is the work that needs infrastructure the repository does not have: a
linked Supabase project, a RevenueCat project, the book files, and Docker. See
[Current Readiness](#current-readiness).

## Release Blockers

### 1. Correct PDF authorization

**Status:** Fixed — catalogue is subscription-only. `get-signed-pdf` grants access only when the caller is an admin **or** `entitlement_has_access(status, expires_at)` is true for a published book. `books.is_premium` is not consulted for the gate; the global bypass flag was removed. E2E covers lifecycle statuses (trial / cancelled / grace / expired).

**Owner:** `supabase/functions/get-signed-pdf/index.ts`

### 2. Make RevenueCat webhooks idempotent and order-safe

**Status:** Fixed.

- Migration `20260831140000_revenuecat_events_idempotency.sql` (+ pgAdmin `09_…`)
  - Table `revenuecat_events` (unique event id, service role only)
  - Columns `entitlements.last_revenuecat_event_id` / `last_revenuecat_event_at`
  - RPC `apply_revenuecat_entitlement()` — race-safe upsert that skips older events
- `revenuecat-webhook` validates event UUID, Auth UUID `app_user_id`, profile existence,
  `event_timestamp_ms`; duplicate → 200; stale → 200 ignored; uses shared error envelope

**Remaining:** Live sandbox matrix against RevenueCat after hosted deploy (needs project + RC project).

**Owner:** `supabase/functions/revenuecat-webhook/index.ts` + migration above

### 3. Make the migration path complete and reproducible

**Status:** Docs updated — `docs/setup-guide.md` Option 2a lists all migrations through search/admin fixes; `docs/schema.md` lists pgAdmin `08_…`; canonical path is `db push`. Hosted steps in `docs/ops/deploy-checklist.md`.

**Remaining:** Run `db push` against a real empty/staging project to confirm history (needs project ref).

**Owner:** `docs/setup-guide.md`, `docs/schema.md`, `docs/ops/deploy-checklist.md`

### 4. Close the production PDF bypass

**Status:** Fixed, then removed outright, then narrowed again. `get-signed-pdf` no longer
reads `ALLOW_PDF_WITHOUT_ENTITLEMENT`, and `app_settings.allow_pdf_without_entitlement` has
been dropped from the schema. A default of `false` still leaves a switch that one
misconfigured deploy can flip from a place no code review looks, so the switch is gone.

The "free and published" branch is gone too (2026-09-09). The catalogue is
subscription-only, and that branch meant a single unset `is_premium` — one bulk-action
misclick, one importer default — silently served a paid PDF to every signed-in reader.
Access is now admin, or an active entitlement, and there is no third branch. The deploy
checklist tells operators to unset the secret if an earlier deploy created it.

**Owner:** `supabase/functions/get-signed-pdf/index.ts`, `.env.example`, `docs/setup-guide.md`

## High-Priority Hardening

All of this is **done in-repo** as of 2026-09-05, in
`supabase/migrations/20260905120000_release_hardening.sql` and the functions that call it.
Runtime verification still needs a project.

### HTTP contracts — Fixed

Every function enforces its documented method, answers `OPTIONS`, and ends in a catch-all
that returns the `{ error: { code, message } }` envelope. Seventeen read endpoints had no
method guard and would serve a GET body to a POST; they do not any more. `handleError()` in
`_shared/http.ts` is the single tail, so a handler cannot forget the `BadRequestError` branch
and turn a caller's typo into a 500. `npm run ci:static` fails the build on a regression.

### Reading progress integrity — Fixed

The merge option was taken. `upsert_reading_progress()` does it in one
`INSERT ... ON CONFLICT DO UPDATE`, where null means "leave this column alone" and `''`
clears `chapter_label`. Read-modify-write in the Edge Function would have had the same
semantics but lost to itself whenever two devices synced at once.

### Publishing and Storage integrity — Fixed

`storage_object_exists()` answers whether the object is really in the bucket, and
`book_publish_blocker()` turns that into one reason code. `admin-book-create`,
`admin-book-update` and `admin_bulk_update_books` all consult it before publishing; the bulk
RPC returns `skippedBooks: [{ id, reason }]` rather than a bare count. `admin_storage_audit()`
is unchanged and still the tool for cleaning up after the fact.

### Search RPC limits — Fixed

`search_books()` clamps `p_limit` to 1–100 and `p_offset` to 0–10,000 inside the function,
so a direct Data API caller gets the same bounds as one going through `books-search`.

### Pagination scale — Fixed

`rangeFromRequest()` rejects an offset past 10,000 rows with `400 PAGE_OUT_OF_RANGE` instead
of scanning and discarding. Page size stays capped at 100, and every list already ordered on
a stable key with `id` as the tiebreaker. `buildCursorPagination` remains available if a list
ever genuinely needs to go deeper.

### Download records — Decided: telemetry

`downloads-create` records what a device *says* it saved. It is documented as telemetry in
the code, in `docs/api-endpoints.md`, and in the fixtures: it drives the Downloaded shelf and
the admin counter and never gates access. Validation now also confirms the book is visible to
the caller (so a download row cannot be planted against a draft to probe the catalog) and
caps the reported size. If downloads ever need to be trusted for billing, the change is a
short-lived token minted by `get-signed-pdf` — not tighter validation of a client field.

### Audit attribution — Fixed (not in the original audit)

Every CMS write through the admin functions was logged as `system`, because the service-role
key carries no `auth.uid()`. "Who published this?" was unanswerable. `requireAdmin()` now
forwards the verified caller as `x-audit-actor-*`, and `private.audit_write()` reads those
headers only on a `service_role` request. `GET /admin-audit-log` exposes the result.

## Database and Security Audit

Before production deployment:

- Verify RLS is enabled on every exposed table.
- Verify policies restrict user data with ownership predicates.
- Confirm users cannot update `profiles.role` or write `entitlements`.
- Confirm views use intentional security behavior, including `security_invoker` where required.
- Review every `SECURITY DEFINER` function for:
  - fixed `search_path`,
  - explicit authorization checks,
  - restricted `EXECUTE` grants,
  - safe assumptions about RLS bypass.
- Verify Storage policies:
  - covers are public only when intended,
  - PDFs are private,
  - avatars are owner-scoped.
- Run `supabase db advisors` and address security/performance findings.
- Run `admin_storage_audit()` against staging data.
- Confirm service-role credentials never enter the mobile app or public repository.

## Automated Verification

| Item | Status |
| --- | --- |
| Unit tests: pagination, payload validation, progress scale, response envelopes, webhook state transitions | Done — `tests/`, run with `npm run test:unit` |
| Generated test users instead of hard-coded credentials | Done — `e2e-endpoints.sh` already created a fresh user per run; the pinned local keys now come from `supabase status` |
| npm scripts for typecheck, lint, tests | Done — `typecheck`, `lint`, `test:unit`, `ci` |
| CI that validates configuration and checks migrations | Done — contracts, method/manifest agreement, migration ordering, secret scan, `deno check`, `deno lint`, unit tests |
| Local E2E when Docker is available | Unchanged — `npm run test:e2e` |
| Hosted staging smoke-test checklist | Done — `docs/ops/deploy-checklist.md` section G |

The webhook state machine moved to `_shared/revenuecat.ts` and the progress scale rules to
`_shared/progress.ts` specifically so they can be tested without a database or a network.

## Staging Smoke-Test Matrix

Run these cases against a real staging project:

| Area | Cases |
| --- | --- |
| Public catalog | Home, books list, detail, categories, collections, plans |
| Search | Title, author, description, tag, empty query, punctuation, unpublished book |
| Pagination | First page, later page, oversized page size, invalid page, empty final page |
| Authentication | Missing token, invalid token, valid user, expired session |
| User data | Profile read/update, progress, wishlist, downloads, highlights, library |
| PDF access | Free book, premium book, active entitlement, expired entitlement, admin, draft, missing object |
| Admin | Non-admin denial, admin reads, partial updates, invalid input, publishing checks |
| Webhook | Valid event, duplicate event, stale event, unknown user, malformed event |
| Storage | Private PDF denied anonymously, signed URL works, missing object handled cleanly |

## Release Sequence

1. Fix the four release blockers.
2. Add the webhook idempotency migration.
3. Complete progress, publishing, search-limit, and method-contract hardening.
4. Synchronize migration and setup documentation.
5. Run database security review and `supabase db advisors`.
6. Reset a clean local database or deploy to staging.
7. Regenerate `types/database.ts` after migrations.
8. Deploy all functions listed in `supabase/functions/_shared/endpoint-manifest.ts`.
9. Configure secrets, with PDF bypass disabled in production.
10. Run the staging smoke-test matrix.
11. Confirm the frontend uses canonical function routes and `error.code`.
12. Record rollback steps, required secrets, and migration history.
13. Promote the verified artifact to production.

## Already Complete

- Public catalog, search, authenticated user, admin, PDF, and webhook function structure.
- Shared authentication, authorization, HTTP response, payload, and pagination helpers.
- Pagination envelopes and documented API contracts.
- Search vector and indexed full-text search foundation.
- Catalog and admin views.
- RLS policies, storage buckets, grants, and admin role checks.
- Private PDF storage design.
- Deprecated `signed-pdf` compatibility endpoint returning 410.
- Endpoint manifest and route documentation.
- Editor diagnostics with no reported errors.

## Current Readiness

**Everything that can be done in the repository is done**, including the one-pass deploy
script, hosted smoke script, and manual staging deploy workflow. What remains needs
infrastructure:

| Remaining | Needs |
| --- | --- |
| Email Auth + first admin promote + re-login | Dashboard + SQL (checklist §F) |
| RevenueCat sandbox event matrix | A RevenueCat project + store products |
| Real catalog imported, `admin_storage_audit()` clean | `BOOKS_DIR` with the book files |
| Local E2E run | Docker |
| Google OAuth end to end | Google Cloud + Dashboard configuration |
| Production project twin | New Supabase project + secrets |

Ship path: [`docs/ops/deploy-checklist.md`](./ops/deploy-checklist.md) · FE env: [`docs/ops/fe-handoff.md`](./ops/fe-handoff.md).

Static review, contract enforcement, unit tests, and CI catch what they can without a
running database. Hosted verification is blocked on access rather than on code.
