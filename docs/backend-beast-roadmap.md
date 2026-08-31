# Ilm o Irfan — Absolute Beast Backend Roadmap

Goal: production-grade Supabase backend that is secure, operable, content-ready, observable, and ready for the React Native app to plug into without mocks.

**Source of truth today:** `feat/app-optimization` / `origin/dev` (same tip).  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Do not build from:** docs-only `main` until `dev` is merged.

**Progress:**  
- §1 doc/path/env hygiene — **done**  
- §2 hosted infra — **prep done in-repo**; blocked on your Supabase **project ref** (Docker not installed on this machine for local Path C)

---

## Status legend

- [x] Done
- [ ] Still needed
- [~] Partial / ops outside git

---

## 1. Branch & repo hygiene

- [ ] Merge `dev` → `main` when release-ready
- [ ] Align or delete stale remotes (ops)
- [x] Paths, Cursor rules, README, setup-guide, `.env.example`, checklist honesty
- [ ] Tag releases / protect `main`

---

## 2. Hosted infrastructure

- [x] `docs/ops/deploy-checklist.md` (full A–I steps, no secrets in git)
- [x] npm scripts: `link`, `functions:deploy`, `functions:list`
- [x] Migration docs complete (setup-guide + schema.md + pgAdmin `08_`)
- [x] Paywall-safe defaults documented for deploy
- [x] Release blocker: free-book PDF auth fixed in `get-signed-pdf` + e2e cases
- [ ] **Create / confirm staging Supabase project** (needs you)
- [ ] **Create / confirm production Supabase project** (needs you)
- [ ] `supabase login` + `npm run link -- --project-ref …`
- [ ] `npm run db:push` on staging then prod
- [ ] `npm run functions:deploy` + `functions:list` verify
- [ ] Set secrets with paywall **false**
- [ ] Confirm `app_settings.allow_pdf_without_entitlement = false`
- [ ] Promote first admin + re-login
- [ ] Verify Storage buckets/policies
- [ ] Private ops note (password manager — not git)
- [ ] Local Docker Path C (optional; Docker not installed here)

---

## 3. Auth (production-ready)

- [~] Email/password enabled
- [ ] Google OAuth + RN deep links
- [ ] Branded email templates
- [ ] Launch confirmations policy
- [ ] Signup metadata + admin claim test matrix

---

## 4. Content pipeline

- [ ] Seed hero/trending/new-arrivals collections
- [ ] Harden `books:import`
- [ ] Upload covers/PDFs + publish + `admin_storage_audit()`

---

## 5. Billing & entitlements

- [ ] RevenueCat project + webhook + sandbox event matrix
- [ ] Webhook idempotency / order-safety (audit blocker #2 — still open)
- [ ] Keep entitlements client-write-proof

---

## 6–11. Remaining (after hosted is live)

API polish, admin EF wrappers, CI, FE contract — see prior full roadmap / `docs/backend-audit-remaining-work.md`.

---

## Suggested order (remaining)

1. ~~Doc/path hygiene~~ **DONE**
2. ~~Deploy prep (checklist, scripts, PDF free-book fix)~~ **DONE in-repo**
3. **You:** create Supabase project → send **project ref** → we link/push/deploy/secrets/smoke
4. Auth email + Google + first admin
5. Content import + Storage
6. Billing sandbox + webhook hardening
7. API polish + admin EFs + CI + merge to `main`
