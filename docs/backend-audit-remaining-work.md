# Backend Audit: Remaining Work

**Date:** 2026-08-31  
**Scope:** Supabase/PostgreSQL backend for the Ilm o Irfan mobile app  
**Status:** Structurally complete, not yet production-ready

## Executive Summary

The backend has the main catalog, user, admin, PDF, and RevenueCat webhook functions in place. Shared pagination, authentication helpers, response envelopes, database views, RLS policies, storage buckets, and admin authorization foundations are present.

The remaining work is primarily release hardening and runtime verification. Four issues should be treated as release blockers: PDF authorization for free books, webhook replay and ordering protection, complete migration deployment documentation, and production-safe PDF bypass configuration.

## Release Blockers

### 1. Correct PDF authorization

**Risk:** `get-signed-pdf` currently performs entitlement checks for non-admin users without first checking whether the book is premium. This can prevent users from opening legitimate free books.

**Required work:**

- Select and evaluate `books.is_premium` in the PDF handler.
- Require an active entitlement only when `is_premium = true`.
- Preserve admin access to published and draft PDFs.
- Keep the global no-entitlement override disabled by default.
- Test free, premium, draft, missing-PDF, expired-entitlement, and admin cases.

**Owner:** `supabase/functions/get-signed-pdf/index.ts`

### 2. Make RevenueCat webhooks idempotent and order-safe

**Risk:** A duplicate or delayed RevenueCat event can overwrite a newer entitlement state. The webhook also trusts `app_user_id` without validating its format or user existence.

**Required work:**

- Require and validate a stable RevenueCat event identifier.
- Validate `app_user_id` as a UUID.
- Confirm that the user exists before writing an entitlement.
- Persist processed event IDs in a dedicated table with a unique constraint.
- Reject duplicate events safely.
- Store event timestamps and ignore stale events.
- Keep malformed and internal failures in the structured error envelope.
- Add tests for duplicate, stale, unknown-user, malformed, active, expired, and cancellation events.

**Recommended database design:** Add a dedicated `revenuecat_events` table rather than storing only one event ID on `entitlements`, because one user can produce many valid events.

**Owner:** `supabase/functions/revenuecat-webhook/index.ts` plus a new forward-only migration.

### 3. Make the migration path complete and reproducible

**Risk:** Manual setup documentation does not consistently list the latest migrations. A database created from the documented list may be missing search, admin-view, and PDF access fixes.

**Required work:**

- Treat `supabase/migrations/` as the canonical schema source.
- Update `docs/setup-guide.md` and `docs/schema.md` through:
  - `20260826220000_app_settings_pdf_access.sql`
  - `20260830120000_admin_cms_v2.sql`
  - `20260831130000_search_views_and_admin_fixes.sql`
- Keep the pgAdmin one-shot workflow synchronized, or clearly mark it as non-production/schema-exploration only.
- Test the full migration chain against an empty database.
- Verify migration history and repeatability before staging deployment.

### 4. Close the production PDF bypass

**Risk:** `.env.example` currently shows `ALLOW_PDF_WITHOUT_ENTITLEMENT=true`. Copying this value into a production environment would make premium PDFs freely accessible.

**Required work:**

- Change the example value to `false`, or remove it from production-facing configuration examples.
- Add an explicit deployment check that rejects the bypass in production.
- Keep the database setting `app_settings.allow_pdf_without_entitlement` off in production.
- Document separate development/staging configuration clearly.

**Owner:** `.env.example`, `supabase/functions/get-signed-pdf/index.ts`, deployment documentation.

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
