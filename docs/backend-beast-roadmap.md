# Ilm o Irfan — Absolute Beast Backend Roadmap

Goal: production-grade Supabase backend that is secure, operable, content-ready, observable, and ready for the React Native app to plug into without mocks.

**Source of truth today:** `feat/app-optimization` / `origin/dev` (same tip).  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Do not build from:** docs-only `main` until `dev` is merged.

**Progress:** §1 doc/path/env hygiene — **done** (2026-08-31). Next: §2 hosted infrastructure (needs your Supabase project).

---

## Status legend

- [x] Done
- [ ] Still needed
- [~] Partial / ops outside git

---

## 1. Branch & repo hygiene

- [ ] Merge `dev` → `main` when release-ready (ops — after later sections)
- [ ] Align or delete stale remotes: `feat/app-functioanlity`, empty `staging-1.0.0` (ops)
- [x] FE/BE paths corrected to `D:\ilm-o-irfan-books-app` and `D:\ilm-o-irfan-books-app-BE`
- [x] Cursor rules + `DESCRIPTION.md` + README companion path fixed
- [x] `docs/setup-guide.md` paths + full migration list + EF inventory fixed
- [x] `.env.example` paywall default **false** + Google placeholders + prod warning
- [x] Setup-guide secrets example defaults paywall **closed**
- [x] README Auth wording honest (Google when enabled); scripts list complete
- [x] `docs/backend-stack.md` checklist honest (BE + FE copies synced)
- [x] Empty stub migration documented (kept for history continuity)
- [ ] Tag releases after deploy verification
- [ ] Protect `main` / require PR reviews

---

## 2. Hosted infrastructure (must ship) — NEXT

- [~] Create / confirm production Supabase project
- [ ] Separate staging project
- [ ] `supabase link` + `db push`
- [ ] Deploy **every** Edge Function
- [ ] Set secrets (paywall **false** in prod)
- [ ] Confirm `app_settings.allow_pdf_without_entitlement = false`
- [ ] Promote first admin + re-login
- [ ] Verify Storage policies
- [ ] Private ops note (no secrets in git)

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
- [ ] Keep entitlements client-write-proof

---

## 6. API polish & admin EF wrappers

- [ ] `home-feed` featured/hero; `date_of_birth` on profile-update; streak read + lock
- [ ] Finished/history + highlights in library; highlights-delete; avatar upload docs
- [ ] Wrap remaining admin SQL RPCs as Edge Functions
- [ ] OpenAPI / fixtures; freeze v1 contract

---

## 7–10. Security, CI, performance, data quality

- [ ] RLS e2e suite; webhook rotation runbook; CORS review
- [ ] GitHub Actions + extended e2e; staging≠prod; incident runbooks
- [ ] Explain-analyze hot paths; PDF size budget
- [ ] Publish checklist; soft vs hard delete policy

---

## 11. FE contract

- [ ] Field map + fixtures; gate on `canAccessPremium`
- [ ] FE: Supabase + RC SDKs (FE repo)

---

## 12. Explicit non-goals (v1)

No Nest API, Redis, Realtime, push marketing, PDF bytes in Postgres, audio streaming schema.

---

## Suggested order (remaining)

1. ~~Doc/path hygiene + paywall-safe `.env.example`~~ **DONE**
2. **Deploy** staging (needs project access from you)
3. Auth email + Google + first admin
4. Content import + Storage + publish
5. Billing sandbox
6. API polish + admin EFs
7. Harden + CI + merge to `main`
