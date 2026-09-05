# Ilm o Irfan — Absolute Beast Backend Roadmap

Goal: production-grade Supabase backend that is secure, operable, content-ready, observable, and ready for the React Native app to plug into without mocks.

**Source of truth today:** branch `dev` (`origin/dev`).  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Do not build from:** docs-only `main` until `dev` is merged.

**Last audited:** 2026-09-05 against `dev` schema, 57 Edge Functions, FE mocks, and docs.

---

## Status legend

- [x] Done on `dev` (code exists)
- [ ] Still needed
- [~] Partial / ops / config outside git

---

## 0. Already in place (do not rebuild)

- [x] PostgreSQL schema (catalog, profiles, library, plans, entitlements, app_settings, admin audit)
- [x] RLS + hardening (grants, search_path, indexes, FTS / `search_books`)
- [x] Storage buckets: `covers` (public), `pdfs` (private), `avatars` (owner)
- [x] Auth bootstrap trigger → `profiles` + `reading_streaks`
- [x] Admin role model (`profiles.role` + JWT `app_role` sync + last-admin guard in SQL)
- [x] Admin CMS v2 views + SECURITY DEFINER RPCs
- [x] 57 Edge Functions (catalog, user library, PDF, webhook, full admin CMS)
- [x] Shared helpers (`_shared/auth`, `http`, `pagination`, `payload`, `progress`, `publishing`, `revenuecat`, `rpc`, `endpoint-manifest`)
- [x] Unit tests + CI (contracts, method enforcement, secret scan, typecheck, lint)
- [x] Runbooks (`docs/runbooks/`) and the env matrix (`docs/ops/env-matrix.md`)
- [x] Unified API envelopes + error codes (`docs/api-endpoints.md`)
- [x] Seed: categories + `premium_monthly` + local `admin@` / `test@` users
- [x] Docs: stack, schema, setup, API endpoints
- [x] `types/database.ts` generation + `import-folder-books` + `e2e-endpoints.sh`
- [x] pgAdmin one-shot SQL under `sql/pgadmin/`

### Edge Functions inventory (deploy all of these)

| Area | Functions |
| --- | --- |
| Public | `home-feed`, `books-list`, `book-detail`, `books-search`, `categories-list`, `collections-list`, `plans-list` |
| User | `profile-read`, `profile-update`, `reading-progress`, `wishlist-list`, `wishlist-toggle`, `downloads-list`, `downloads-create`, `highlights-list`, `highlights-upsert`, `highlights-delete`, `library-overview`, `entitlements-status`, `get-signed-pdf`, `avatar-upload-url` |
| Admin — read | `admin-books`, `admin-authors`, `admin-categories`, `admin-collections`, `admin-plans`, `admin-users`, `admin-user-detail`, `admin-analytics`, `admin-dashboard-stats`, `admin-settings`, `admin-audit-log`, `admin-storage-audit` |
| Admin — write | `admin-book-create`/`-update`/`-delete`, `admin-bulk-update-books`, `admin-author-create`/`-update`/`-delete`, `admin-category-create`/`-update`/`-delete`, `admin-collection-create`/`-update`/`-delete`, `admin-plan-create`/`-update`/`-delete`, `admin-set-book-relations`, `admin-set-collection-books`, `admin-reorder`, `admin-set-entitlement`, `admin-set-user-role`, `admin-delete-storage-object` |
| Special | `revenuecat-webhook`, `signed-pdf` (deprecated → 410) |

---

## 1. Branch & repo hygiene

- [ ] Merge `dev` → `main` when release-ready (main is still init/docs-only)
- [ ] Align or delete stale remotes: `feat/app-functioanlity`, `feat/app-optimization` (alias of `dev`), empty `staging-1.0.0`
- [ ] Fix remaining wrong paths in docs/rules (still present in places):
  - FE: `D:\ilm-o-irfan-books-app` (not `D:\Projects\Ilm-o-Irfan-App-FE`)
  - BE: `D:\ilm-o-irfan-books-app-BE` (not `D:\Projects\Ilm-o-Irfan-App-BE` in `docs/setup-guide.md`)
- [ ] Tag releases (`v1.0.0-staging`, etc.) after deploy verification
- [ ] Protect `main` / require PR reviews
- [x] Empty stub migration kept deliberately (commented no-op — deleting it breaks the ledger on any database that already recorded it)
- [ ] Sync stale doc claims: setup-guide / stack checklist still imply “only PDF + webhook” EFs; README claims Google Auth while `config.toml` has Google `enabled = false`

---

## 2. Hosted infrastructure (must ship)

- [~] Create / confirm production Supabase project
- [ ] Separate **staging** project (same migrations, different data/secrets)
- [ ] `supabase link` + `db push` (all migrations applied) on staging then prod
- [ ] Deploy **every** Edge Function (not only PDF + webhook)
- [x] npm/docs scripts for deploy + secrets (`functions:deploy`, deploy checklist, env matrix)
- [ ] Set function secrets / env (env matrix: local / staging / prod):

  | Variable | Local | Staging | Prod |
  | --- | --- | --- | --- |
  | `SUPABASE_URL` / anon / service role | local | staging | prod |
  | `REVENUECAT_WEBHOOK_AUTH` | test secret | staging secret | rotated prod secret |
  | `REVENUECAT_ENTITLEMENT_ID` | `premium` | `premium` | `premium` |
  | `SIGNED_PDF_EXPIRES_IN` | 300 | 300 | 300 (or shorter) |
  | Google OAuth client ids | optional | required if testing Google | required |

- [x] `ALLOW_PDF_WITHOUT_ENTITLEMENT` removed from the code entirely — no default to get wrong, and `.env.example` says so
- [ ] Promote first admin (`UPDATE profiles SET role = 'admin' …` or future EF) and force re-login
- [x] Storage policies verified against the hosted project; the broad `covers_public_read` SELECT policy that let any client enumerate the bucket was dropped in `20260905140000`
- [ ] Private ops note: project refs, webhook URLs, secret locations (never commit secrets)
- [ ] Upgrade to Supabase Pro before public launch (PITR / reliability)

---

## 3. Auth (production-ready)

- [~] Email/password Auth enabled (`enable_signup = true`)
- [ ] Google OAuth fully configured (Dashboard + Google Cloud + `config.toml` / hosted provider)
- [ ] RN deep-link / redirect URLs for iOS + Android (today `site_url` / redirects are `127.0.0.1:3000` only)
- [ ] Email templates (confirm, reset) branded for Ilm o Irfan
- [ ] Launch decision: email confirmations on vs soft (`enable_confirmations` is currently `false` locally)
- [ ] Rate limits / abuse defaults reviewed on hosted Auth
- [ ] Password reset flow verified (Auth supports it; FE has no Forgot UI yet — still BE-ready)
- [ ] Signup metadata contract frozen: `full_name`, `phone` → `handle_new_user` → `profiles`
- [ ] Test matrix: signup → profile row → JWT; Google signup; admin promote → re-login → `app_role` claim

---

## 4. Content pipeline (empty catalog = dead app)

Seed intentionally has **no books, no authors, no collections**. Old dummy shelves were removed (`sql/pgadmin/05_remove_dummy_seed_books.sql`). After `db reset`, `home-feed` / `collections-list` are empty.

- [x] Canonical collections seeded (`home-hero`, `trending`, `new-arrivals`, `beginners-path`, `ramadan-reading`)
- [x] Canonical folder layout for covers + PDFs documented beside `books:import`
- [x] Hardened `scripts/import-folder-books.mjs`:
  - Stop hardcoding `BOOKS_DIR=D:/Projects/Books` as the only default
  - Create or require collection rows before joining (`new-arrivals` / `trending` currently silent no-ops)
  - Support `is_premium` flag, real category slugs, author upsert, publish gate
  - Document cover naming + Storage path conventions
- [ ] Upload all objects to Storage with stable paths (`covers/…`, `pdfs/…`)
- [ ] Authors, categories, collections, hero shelves populated with real titles
- [x] Publish gate enforced against Storage, not just the column (`book_publish_blocker()`)
- [ ] Cover public URLs verified in app-sized cards
- [ ] Run `admin_storage_audit()` — zero broken references / orphans cleaned via `admin_delete_storage_object`
- [ ] Staging vs production catalog strategy (same schema, different data)
- [ ] Document INP→PDF pipeline handoff (`FE docs/inp-to-pdf-conversion.md` → Storage `pdfs`)
- [ ] Decide: audio lessons are marketing copy only for v1 (no audio schema) — keep out of catalog schema

---

## 5. Billing & entitlements

- [ ] RevenueCat project + entitlement id `premium`
- [ ] Store products (App Store + Play) mapped to plan `premium_monthly` / `revenuecat_product_id`
- [ ] Webhook → `…/functions/v1/revenuecat-webhook` with matching `Authorization` header
- [ ] Enforce `app_user_id` = Supabase Auth UUID (document + verify in sandbox)
- [ ] Sandbox purchase → `entitlements` upsert → `entitlements-status` (`isActive`, `isAdmin`, `canAccessPremium`)
- [ ] Event matrix tested: initial purchase, renew, cancel, billing_issue, expire, product change
- [ ] Manual comps via `admin_set_entitlement` (document that RC webhook can overwrite; `store = 'promotional'`)
- [ ] Never allow client writes to `entitlements` (keep as hard rule — already RLS-enforced)
- [ ] Align plan display: `price_cents` 149900 PKR vs store-localized IAP prices (display rules for FE)
- [ ] Webhook auth rotation runbook

---

## 6. API surface — close remaining gaps

### 6.1 App-facing (mostly done)

- [x] Public catalog EFs
- [x] Authenticated library EFs
- [x] `get-signed-pdf` + deprecated `signed-pdf` 410
- [x] **`home-feed` product shape:** today returns generic collections + newest books + categories; does **not** use `app_settings.featured_collection_id` or guarantee `kind='hero'` / trending shelves for FE Home
- [ ] Trending semantics (optional): most-read window vs “newest published” (FE mock says Trending)
- [x] `profile-update`: add `date_of_birth` to editable allow-list (column exists; FE Personal Details needs it; email stays Auth-owned)
- [x] Streak read: exposed via `profile-read` or dedicated EF (`reading_streaks` exists + trigger; no EF today)
- [x] Streak writes locked to the trigger: authenticated can currently `UPDATE` own `reading_streaks` via Data API — prefer trigger-only writes
- [x] `highlights-delete` EF (RLS allows delete; only list/upsert EFs exist)
- [x] Finished / history shelf or document derive rule (`progress >= 0.99` / `last_read_at`) and include in `library-overview`
- [x] Highlights summary included in `library-overview` (or document FE must call `highlights-list`)
- [x] Avatar: signed upload URL EF (`avatar-upload-url`) + signed read URL on `profile-read` **or** documented direct Storage upload → then `profile-update.avatar_path`
- [x] Contract freeze: checked-in response fixtures for FE (`docs/fixtures/`)
- [x] Versioning / stability notes in README + fixtures README
- [ ] Pagination + cold-start load-tested on `home-feed` + `books-search`

### 6.2 Admin CMS Edge Function completeness

SQL RPCs exist; day-to-day CMS should not require SQL. Wrap:

| RPC / need | Status |
| --- | --- |
| `admin-book-create` | [x] Done |
| `admin_delete_books` + storage purge | [x] `admin-book-delete` |
| `admin_bulk_update_books` | [x] `admin-bulk-update-books`, now storage-aware on publish |
| `admin_set_book_relations` | [x] `admin-set-book-relations` |
| `admin_set_collection_books` | [x] `admin-set-collection-books` |
| `admin_reorder` (categories / collections) | [x] `admin-reorder` |
| `admin-authors` CRUD (`admin_author_rows`) | [x] list + create / update / delete |
| `admin-categories` write / reorder | [x] `admin-category-create` / `-update` / `-delete` |
| `admin-collections` write / reorder / membership | [x] `admin-collection-create` / `-update` / `-delete` |
| `admin_set_entitlement` | [x] `admin-set-entitlement` |
| `admin_set_user_role` | [x] `admin-set-user-role` |
| `admin_user_detail` | [x] `admin-user-detail` |
| `admin_dashboard_stats` | [x] `admin-dashboard-stats` |
| `admin_storage_audit` + `admin_delete_storage_object` | [x] Both wrapped |
| `admin_audit_log` query | [x] `admin-audit-log`, filterable by entity / actor / action / date |
| Admin plans CRUD | [x] `admin-plans` + create / update / delete |

### 6.3 Nice-to-have product APIs

- [ ] Clarify FE “Saved lessons” → map to `wishlist` (product naming)
- [ ] Support email / about: expose `app_settings.support_email` (already in settings) to app About if needed
- [ ] Forgot-password is Auth-native — no custom EF required

---

## 7. Security hardening (beast mode)

- [x] Production paywall closed — the bypass flag is gone from the code, not merely defaulted off
- [ ] Service role key never in the mobile app (anon + user JWT only)
- [x] Reviewed `verify_jwt` flags in `config.toml` per function (public catalog + webhook + deprecated `signed-pdf` are `false`)
- [ ] Decide fate of deprecated `signed-pdf` (keep 410 forever vs remove from deploy)
- [ ] CORS: `_shared/http.ts` uses `Access-Control-Allow-Origin: *` — OK for mobile; tighten if admin web ships
- [ ] Signed URL TTL short; no long-lived public PDF links; confirm **no client SELECT** on bucket `pdfs`
- [ ] RLS regression suite (automated):
  - anon cannot read unpublished books
  - user cannot INSERT/UPDATE/DELETE `entitlements`
  - user cannot UPDATE `profiles.role`
  - non-admin cannot call admin EFs / RPCs
  - non-entitled user gets `PREMIUM_REQUIRED` from `get-signed-pdf`
- [ ] Last-admin demotion guard verified in e2e
- [x] Streak column not client-writable
- [x] Webhook: secret required, malformed envelopes rejected, shared helpers; rotation runbook written
- [x] Secrets scanning in CI (fails the build on a key-shaped string; also asserts `.env` is gitignored)
- [ ] Dependency / `deno.lock` kept current

---

## 8. Reliability, observability, CI/CD

- [x] GitHub Actions on PR:
  - contract checks (folders / config / manifest / methods) and migration ordering
  - `deno check`, `deno lint`, `deno test`
  - secrets scan
- [~] `scripts/e2e-endpoints.sh` still needs Docker + a local stack, so CI documents the skip rather than pretending to run it. Local keys now come from `supabase status` instead of a pinned copy.
- [ ] Extend e2e beyond happy paths: webhook auth failure, storage miss (`PDF_NOT_IN_STORAGE`), premium gate, admin forbidden, import + storage audit
- [ ] Staging project separate from production with promotion checklist
- [ ] Structured logging + alert on webhook failures / 5xx spikes (Dashboard + optional Sentry)
- [ ] Uptime checks on `home-feed` + `entitlements-status` + `get-signed-pdf` health path
- [ ] Backup / PITR awareness (Supabase Pro)
- [x] Incident runbooks (committed under `docs/runbooks/`):
  - paywall stuck open
  - webhook down / entitlement drift
  - storage miss / broken `pdf_path`
  - auth / Google redirect failures
  - secret rotation

---

## 9. Performance & scale

- [ ] `EXPLAIN ANALYZE` hot paths: `search_books`, home-feed views, `library-overview`
- [ ] Re-check indexes after real catalog size (1k / 10k books)
- [ ] PDF size budget + compression guidelines (egress cost)
- [ ] CDN / cache headers for public covers
- [ ] Edge Function cold-start budget acceptable on RN splash/home
- [ ] No Redis unless measured need (default: no Redis for v1)

---

## 10. Data quality & admin ops

- [ ] Publish checklist: PDF present, cover present, author set, categories set, collection membership
- [ ] Slug uniqueness + stable slugs enforced in import
- [ ] Collection `kind` used correctly (`hero` \| `shelf` \| `carousel`)
- [ ] Currency / `price_cents` consistency (PKR catalog vs store IAP display)
- [ ] Soft-delete vs hard-delete policy for books (today: hard delete RPC returns paths to purge)
- [ ] Audit log queries for support (“who published X”) — needs query path (§6.2)
- [ ] Support comps + refunds procedure (RC + `admin_set_entitlement`)

---

## 11. FE ↔ BE contract alignment

Backend is not “beast” until the mobile contract is frozen. FE today is still a **mock shell** (no Supabase / RevenueCat SDKs).

### 11.1 Backend-owned contract work

- [ ] Field map FE camelCase ↔ DB / EF snake_case documented and stable (`docs/schema.md` has a start — finish + fixtures)
- [ ] Gate premium UI on `canAccessPremium` (not only `isActive`) — document in API + FE
- [ ] Progress: `progress` (0–1) **or** `progress_percent` (0–100), never both
- [ ] Partial update semantics documented and tested
- [ ] Checked-in response fixtures for: `home-feed`, `book-detail`, `library-overview`, `entitlements-status`, `get-signed-pdf`
- [ ] Document mock → real mappings:

  | FE mock | Backend |
  | --- | --- |
  | `author: string` | nested `author` / `author_name` |
  | `readTime: "4 hr read"` | `read_time_minutes` (format on client) |
  | `price` float | `price_cents` + `currency` |
  | `coverColor` / `coverColorDark` | `cover_color` / `cover_color_dark` (+ `cover_path`) |
  | mock ids (`hero-1`, …) | UUIDs |
  | `chapter` / `timeLeft` | `chapter_label`; `timeLeft` client-computed |
  | `dateOfBirth` | `date_of_birth` (add to `profile-update`) |
  | editable email | Auth-owned, not `profile-update` |
  | `renewsOn` | `entitlements.expires_at` |

### 11.2 FE wiring (tracked here so BE “done” is honest — implement in FE repo)

- [ ] Add `@supabase/supabase-js` + MMKV session adapter
- [ ] Add RevenueCat `react-native-purchases`
- [ ] Replace mocks: Home, Search, Detail, Library, Profile, Subscription
- [ ] Reader: `get-signed-pdf` → device FS → `react-native-pdf`; POST progress; download CTA → `downloads-create`
- [ ] Wire Wishlist into navigator
- [ ] Theme / language / notification / privacy toggles stay **FE-only** (v1)

---

## 12. Docs & developer experience

- [x] Env matrix doc — `docs/ops/env-matrix.md`
- [x] Fixture pack linked from README
- [ ] Production ingest how-to (`BOOKS_DIR` layout, premium flags, publish, audit)
- [x] README scripts section documents every npm script
- [x] Refreshed `docs/setup-guide.md` functions inventory (all 57)
- [ ] Refresh `docs/backend-stack.md` checklist vs current EF surface
- [x] `docs/runbooks/` written
- [ ] Keep Cursor rule FE path correct

---

## 13. Explicit non-goals (v1)

Do **not** block launch on these:

- [ ] Custom Nest/Express API
- [ ] Redis / Upstash
- [ ] Realtime live progress sync
- [ ] Push / email marketing automation
- [ ] Heavy third-party product analytics (store + RC first)
- [ ] Storing PDF/cover bytes in Postgres
- [ ] Audio lesson streaming schema (marketing copy only until product decides)
- [ ] Consumer Admin CMS inside the RN app (separate admin web later; EFs/RPCs are enough)

---

## Suggested execution order

1. **Doc/path hygiene** + paywall-safe `.env.example` warnings  
2. **Deploy** staging: migrations + all functions + secrets (paywall closed)  
3. **Auth** email + Google + redirects + first admin  
4. **Content** seed collections → harden import → Storage → publish → storage audit  
5. **Billing** RevenueCat webhook sandbox → entitlement → signed PDF  
6. **App API polish** home-feed hero/featured, DOB update, streak read + lock, library finished/highlights  
7. **Admin EF wrappers** for remaining RPCs (CMS without SQL)  
8. **Harden** RLS e2e, CI, runbooks, staging→prod  
9. **Freeze API** fixtures / OpenAPI + support FE wiring  
10. **Merge `dev` → `main`**, tag, protect branches  

---

## Definition of “absolute beast”

Backend is beast when:

1. Empty phone can signup (email + Google), browse a **real** catalog, open a gated PDF, buy Premium, download offline, and resume progress — all against hosted Supabase.
2. Admins can manage catalog, authors, collections, users, comps, and storage audit **without raw SQL** for day-to-day work.
3. Entitlements are webhook-only; PDFs never public; paywall cannot accidentally stay open in prod.
4. Staging + CI catch regressions; e2e covers premium gate and storage miss.
5. Ops can diagnose webhook, storage, auth, and paywall failures from short runbooks.
6. FE contract is frozen (fixtures/field map) so the RN app can drop mocks without guessing.

---

## Progress snapshot

**Progress report:** [`backend-work-progress.md`](./backend-work-progress.md)  
**Audit:** [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md)

Every code track — §1 hygiene, §2 deploy prep, §4 content pipeline, §5 webhook, §6 API and
admin surface, §7 security hardening, §8 CI and runbooks, §11 contract freeze, §12 docs — is
**done in-repo** as of 2026-09-05.

What remains needs infrastructure, not code:

| Blocked on | Items |
| --- | --- |
| A Supabase project ref + CLI login | §2 hosted deploy, §3 Auth configuration, migration history verification |
| Docker | §8 local E2E run |
| `BOOKS_DIR` with the real files | §4 catalog ingest, cover verification, storage audit |
| RevenueCat + store accounts | §5 sandbox event matrix |
| Your call | §1 merge to `main`, tag, branch protection |

---

## Suggested next

1. **You:** project ref → link → `db:push` → `functions:deploy` → secrets → smoke (deploy checklist section G)
2. **You:** books folder → `BOOKS_DIR=… npm run books:import` → `admin-storage-audit`
3. **You:** RevenueCat project + Google OAuth in the Dashboards
4. **Then:** run the §8 staging matrix, tag, and merge `dev` → `main`

---

## Done checklist

- [x] Hygiene, paywall removed from code, free-book PDF, webhook ledger
- [x] Seed shelves, hardened import, home-feed / library / profile, streak lock
- [x] Admin CMS complete without raw SQL — books, authors, categories, collections, plans, entitlements, roles, storage, audit log
- [x] HTTP contracts, partial-update semantics, storage-aware publishing, search and pagination limits
- [x] Audit attribution: every CMS write names the admin who made it
- [x] Unit tests, typecheck, lint, secret scan, CI
- [x] Runbooks, env matrix, FE fixture pack
- [ ] Hosted deploy + smoke
- [ ] Real books + storage audit
- [ ] Google OAuth + RC sandbox
- [ ] Merge to `main`
