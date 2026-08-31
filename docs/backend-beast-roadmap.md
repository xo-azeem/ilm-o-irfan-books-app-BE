# Ilm o Irfan — Absolute Beast Backend Roadmap

Goal: production-grade Supabase backend that is secure, operable, content-ready, observable, and ready for the React Native app to plug into without mocks.

**Source of truth today:** branch `dev` (`origin/dev`).  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Do not build from:** docs-only `main` until `dev` is merged.

**Last audited:** 2026-08-31 against `dev` schema, ~28 Edge Functions, FE mocks, and docs.

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
- [x] 28 Edge Functions (catalog, user library, PDF, webhook, admin reads/partial writes)
- [x] Shared helpers (`_shared/auth`, `http`, `pagination`, `payload`, `endpoint-manifest`)
- [x] Unified API envelopes + error codes (`docs/api-endpoints.md`)
- [x] Seed: categories + `premium_monthly` + local `admin@` / `test@` users
- [x] Docs: stack, schema, setup, API endpoints
- [x] `types/database.ts` generation + `import-folder-books` + `e2e-endpoints.sh`
- [x] pgAdmin one-shot SQL under `sql/pgadmin/`

### Edge Functions inventory (deploy all of these)

| Area | Functions |
| --- | --- |
| Public | `home-feed`, `books-list`, `book-detail`, `books-search`, `categories-list`, `collections-list`, `plans-list` |
| User | `profile-read`, `profile-update`, `reading-progress`, `wishlist-list`, `wishlist-toggle`, `downloads-list`, `downloads-create`, `highlights-list`, `highlights-upsert`, `library-overview`, `entitlements-status`, `get-signed-pdf` |
| Admin | `admin-books`, `admin-book-update`, `admin-categories`, `admin-collections`, `admin-users`, `admin-analytics`, `admin-settings` |
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
- [ ] Remove or replace empty stub migration `supabase/migrations/20260802110539_new-migration.sql`
- [ ] Sync stale doc claims: setup-guide / stack checklist still imply “only PDF + webhook” EFs; README claims Google Auth while `config.toml` has Google `enabled = false`

---

## 2. Hosted infrastructure (must ship)

- [~] Create / confirm production Supabase project
- [ ] Separate **staging** project (same migrations, different data/secrets)
- [ ] `supabase link` + `db push` (all migrations applied) on staging then prod
- [ ] Deploy **every** Edge Function (not only PDF + webhook)
- [ ] Add npm/docs scripts for deploy + secrets (`functions:deploy`, secrets checklist)
- [ ] Set function secrets / env (env matrix: local / staging / prod):

  | Variable | Local | Staging | Prod |
  | --- | --- | --- | --- |
  | `SUPABASE_URL` / anon / service role | local | staging | prod |
  | `REVENUECAT_WEBHOOK_AUTH` | test secret | staging secret | rotated prod secret |
  | `REVENUECAT_ENTITLEMENT_ID` | `premium` | `premium` | `premium` |
  | `SIGNED_PDF_EXPIRES_IN` | 300 | 300 | 300 (or shorter) |
  | `ALLOW_PDF_WITHOUT_ENTITLEMENT` | `true` OK | prefer `false` | **`false`** |
  | Google OAuth client ids | optional | required if testing Google | required |

- [ ] Fix `.env.example`: today ships `ALLOW_PDF_WITHOUT_ENTITLEMENT=true` — document clearly as **dev-only**, add prod warning; add Google env placeholders
- [ ] Confirm `app_settings.allow_pdf_without_entitlement = false` in prod
- [ ] Promote first admin (`UPDATE profiles SET role = 'admin' …` or future EF) and force re-login
- [ ] Verify Storage policies match migrations (covers / pdfs / avatars)
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

- [ ] Re-seed canonical collections (`hero`, `trending`, `new-arrivals`, curated shelves) so import + home UI have targets
- [ ] Canonical folder layout for covers + PDFs (document beside `books:import`)
- [ ] Harden `scripts/import-folder-books.mjs`:
  - Stop hardcoding `BOOKS_DIR=D:/Projects/Books` as the only default
  - Create or require collection rows before joining (`new-arrivals` / `trending` currently silent no-ops)
  - Support `is_premium` flag, real category slugs, author upsert, publish gate
  - Document cover naming + Storage path conventions
- [ ] Upload all objects to Storage with stable paths (`covers/…`, `pdfs/…`)
- [ ] Authors, categories, collections, hero shelves populated with real titles
- [ ] Publish only books with valid `pdf_path` (constraint `books_published_needs_pdf` exists)
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
- [ ] **`home-feed` product shape:** today returns generic collections + newest books + categories; does **not** use `app_settings.featured_collection_id` or guarantee `kind='hero'` / trending shelves for FE Home
- [ ] Trending semantics (optional): most-read window vs “newest published” (FE mock says Trending)
- [ ] `profile-update`: add `date_of_birth` to editable allow-list (column exists; FE Personal Details needs it; email stays Auth-owned)
- [ ] Streak read: expose via `profile-read` or dedicated EF (`reading_streaks` exists + trigger; no EF today)
- [ ] Lock down streak cheating: authenticated can currently `UPDATE` own `reading_streaks` via Data API — prefer trigger-only writes
- [ ] `highlights-delete` EF (RLS allows delete; only list/upsert EFs exist)
- [ ] Finished / history shelf EF or document derive rule (`progress >= 0.99` / `last_read_at`) and include in `library-overview`
- [ ] Include highlights summary in `library-overview` (or document FE must call `highlights-list`)
- [ ] Avatar: signed upload URL EF **or** documented direct Storage upload → then `profile-update.avatar_path`
- [ ] Contract freeze: OpenAPI **or** checked-in response fixtures for FE
- [ ] Versioning / stability notes (`v1` freeze) in README
- [ ] Pagination + cold-start load-tested on `home-feed` + `books-search`

### 6.2 Admin CMS Edge Function completeness

SQL RPCs exist; day-to-day CMS should not require SQL. Wrap:

| RPC / need | Status |
| --- | --- |
| `admin-book-create` | [ ] Missing (only `admin-book-update`) |
| `admin_delete_books` + storage purge | [ ] No EF |
| `admin_bulk_update_books` | [ ] No EF |
| `admin_set_book_relations` | [ ] No EF |
| `admin_set_collection_books` | [ ] No EF |
| `admin_reorder` (categories / collections) | [ ] No EF |
| `admin-authors` CRUD (`admin_author_rows`) | [ ] No EF at all |
| `admin-categories` write / reorder | [ ] GET-only EF today |
| `admin-collections` write / reorder / membership | [ ] GET-only EF today |
| `admin_set_entitlement` | [ ] No EF |
| `admin_set_user_role` | [ ] No EF (promote still raw SQL) |
| `admin_user_detail` | [ ] No EF (`admin-users` is list-only) |
| `admin_dashboard_stats` | [ ] No EF (`admin-analytics` uses `admin_analytics` only) |
| `admin_storage_audit` + `admin_delete_storage_object` | [ ] No EF |
| `admin_audit_log` query | [ ] No EF |
| Admin plans CRUD | [ ] Optional; `plans-list` is public read-only |

### 6.3 Nice-to-have product APIs

- [ ] Clarify FE “Saved lessons” → map to `wishlist` (product naming)
- [ ] Support email / about: expose `app_settings.support_email` (already in settings) to app About if needed
- [ ] Forgot-password is Auth-native — no custom EF required

---

## 7. Security hardening (beast mode)

- [ ] Production paywall closed (env **and** `app_settings`)
- [ ] Service role key never in the mobile app (anon + user JWT only)
- [ ] Review `verify_jwt` flags in `config.toml` per function (public catalog + webhook + deprecated `signed-pdf` are `false`)
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
- [ ] Streak column not client-writable (see §6.1)
- [ ] Webhook: require secret; rotate; reject empty/malformed envelopes; prefer shared `fail` helpers
- [ ] Secrets scanning in CI (block `.env`, service role commits)
- [ ] Dependency / `deno.lock` kept current

---

## 8. Reliability, observability, CI/CD

- [ ] GitHub Actions on PR:
  - migration lint / `db push` dry-run where possible
  - function typecheck / deno check if feasible
  - secrets scan
- [ ] Wire `scripts/e2e-endpoints.sh` into CI (needs bash + local Supabase; document Windows story — script is bash-only via `npm run test:e2e`)
- [ ] Extend e2e beyond happy paths: webhook auth failure, storage miss (`PDF_NOT_IN_STORAGE`), premium gate, admin forbidden, import + storage audit
- [ ] Staging project separate from production with promotion checklist
- [ ] Structured logging + alert on webhook failures / 5xx spikes (Dashboard + optional Sentry)
- [ ] Uptime checks on `home-feed` + `entitlements-status` + `get-signed-pdf` health path
- [ ] Backup / PITR awareness (Supabase Pro)
- [ ] Incident runbooks (committed under `docs/runbooks/`):
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

- [ ] Env matrix doc (local / staging / prod)
- [ ] OpenAPI or fixture pack linked from README
- [ ] Production ingest how-to (`BOOKS_DIR` layout, premium flags, publish, audit)
- [ ] README scripts section: document `books:import`, `test:e2e`, `supabase:start|stop`, deploy commands
- [ ] Refresh `docs/setup-guide.md` functions inventory (full 28, not PDF+webhook only)
- [ ] Refresh `docs/backend-stack.md` checklist vs current EF surface
- [ ] `docs/runbooks/` as in §8
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
