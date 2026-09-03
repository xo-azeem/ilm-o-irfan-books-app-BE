# Backend Audit: Remaining Work

**Date:** 2026-08-31  
**Scope:** Supabase/PostgreSQL backend for the Ilm o Irfan mobile app  
**Status:** Structurally complete, not yet production-ready

## Executive Summary

The backend has the main catalog, user, admin, PDF, and RevenueCat webhook functions in place. Shared pagination, authentication helpers, response envelopes, database views, RLS policies, storage buckets, and admin authorization foundations are present.

The remaining work is primarily release hardening and runtime verification. Four issues should be treated as release blockers: PDF authorization for free books, webhook replay and ordering protection, complete migration deployment documentation, and production-safe PDF bypass configuration.

## Release Blockers

### 1. Correct PDF authorization

**Status:** Fixed in `get-signed-pdf` — entitlement is required only when `books.is_premium = true`. Free published books are available to any signed-in user. Admin + global bypass behavior unchanged. E2E paywall section covers free vs premium.

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

**Status:** Fixed — `.env.example` defaults `ALLOW_PDF_WITHOUT_ENTITLEMENT=false` with an explicit production warning. Setup-guide secrets example sets `false`. Deploy checklist requires closed paywall on staging/prod.

**Owner:** `.env.example`, `docs/setup-guide.md`, `docs/ops/deploy-checklist.md`

## High-Priority Hardening

### HTTP contracts

- Confirm every function enforces its documented HTTP method.
- Confirm every failure uses `{ error: { code, message } }`.
- Confirm raw Postgres and runtime error messages are logged server-side only.
- Ensure public, authenticated, and admin routes all use the shared helpers.

### Reading progress integrity

The POST handler currently supplies defaults for omitted fields. A partial update can therefore reset an existing record.

Choose one contract:

- Require all progress fields on every write, or
- Read the current row and merge only supplied fields before upserting.

The second option is more compatible with mobile clients and should be preferred if partial updates are part of the API contract.

### Publishing and Storage integrity

Admin publishing validates that `pdf_path` is present, but a path can point to a missing Storage object.

Required work:

- Check that the PDF object exists before publishing a book, or route publishing through a controlled storage-audit workflow.
- Test missing-object, valid-object, unpublished, and published cases.
- Keep `admin_storage_audit()` available for operational cleanup.

### Search RPC limits

The Edge Function limits search requests, but direct RPC callers can pass excessive values.

Required work:

- Clamp `p_limit` and `p_offset` inside `search_books()`.
- Add tests for negative, null, oversized, and normal values.

### Pagination scale

The current endpoints use offset pagination. This is acceptable for launch-sized data but can become expensive for deep pages.

Required work:

- Add a maximum page or offset, or adopt cursor pagination for large catalog and admin lists.
- Preserve stable ordering with an `id` tiebreaker.
- Keep page size capped at 100.

### Download records

`downloads-create` currently accepts client-attested completion and file size.

Decide whether downloads are:

- **Telemetry only:** document that they are informational and validate only user/book ownership and field ranges, or
- **Trusted accounting:** issue a short-lived download token from `get-signed-pdf` and require it when recording completion.

For launch, telemetry is the simpler and safer product interpretation unless billing or compliance depends on download completion.

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

The repository has `scripts/e2e-endpoints.sh`, but it assumes Docker, local Supabase, Bash, fixed local JWTs, and local fixture data. It is not a hosted-production test.

Remaining automation work:

- Add unit tests for pagination, payload validation, progress scale handling, response envelopes, and webhook state transitions.
- Generate test users and fixtures instead of relying on stale hard-coded credentials.
- Add npm scripts for typecheck, lint, and tests.
- Add CI that installs dependencies, validates configuration, checks migrations, and runs static tests.
- Run local E2E when Docker is available.
- Add a hosted staging smoke-test checklist.

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

**Not production-ready until:**

- Free-book PDF authorization is corrected.
- RevenueCat webhook idempotency and ordering are implemented.
- All migration documentation is synchronized and tested.
- Production configuration cannot enable the PDF bypass accidentally.
- Staging runtime tests pass for Auth, RLS, Storage, Edge Functions, and webhook delivery.

Static review is complete enough to guide implementation. Live verification still requires either a linked Supabase project or Docker Desktop with the local Supabase stack.
