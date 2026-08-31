# Ilm o Irfan — Absolute Beast Backend Roadmap

Goal: production-grade Supabase backend that is secure, operable, content-ready, observable, and ready for the React Native app to plug into without mocks.

**Source of truth today:** `feat/app-optimization` / `origin/dev` (same tip).  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Progress report:** [`docs/backend-work-progress.md`](./backend-work-progress.md)

**Progress:**  
- §1 doc/path/env hygiene — **done**  
- §2 hosted infra — **prep done in-repo**; blocked on your Supabase **project ref**  
- Audit #2 webhook idempotency — **done in-repo** (sandbox verify after deploy)

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

- [x] `docs/ops/deploy-checklist.md`
- [x] npm scripts: `link`, `functions:deploy`, `functions:list`
- [x] Migration docs complete
- [x] Paywall-safe defaults
- [x] Free-book PDF auth fixed
- [x] RevenueCat webhook idempotency migration + EF
- [ ] **Create / confirm staging Supabase project** (needs you)
- [ ] **Create / confirm production Supabase project** (needs you)
- [ ] `supabase login` + link + `db:push` + `functions:deploy` + secrets
- [ ] First admin + Storage verify + smoke

---

## 3. Auth (production-ready)

- [~] Email/password enabled
- [ ] Google OAuth + RN deep links
- [ ] Branded email templates
- [ ] Launch confirmations policy

---

## 4. Content pipeline — NEXT (if no project ref yet)

- [ ] Seed hero/trending/new-arrivals collections
- [ ] Harden `books:import`
- [ ] Upload covers/PDFs + publish + `admin_storage_audit()`

---

## 5. Billing & entitlements

- [x] Webhook idempotency / order-safety (in-repo)
- [ ] RevenueCat project + sandbox event matrix (after hosted)
- [x] Keep entitlements client-write-proof

---

## 6–11. Remaining (after hosted is live)

API polish, admin EF wrappers, CI, FE contract — see [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md).

---

## Suggested order (remaining)

1. ~~Doc/path hygiene~~ **DONE**
2. ~~Deploy prep + PDF free-book fix~~ **DONE in-repo**
3. ~~Webhook idempotency~~ **DONE in-repo**
4. **You:** project ref → link/push/deploy **or** agent continues **§4 content pipeline**
5. Auth Google + first admin
6. Billing sandbox verify
7. API polish + admin EFs + CI + merge to `main`
