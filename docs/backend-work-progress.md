# Ilm o Irfan Backend — Work Progress Report

**Repo:** `D:\ilm-o-irfan-books-app-BE`  
**Companion FE:** `D:\ilm-o-irfan-books-app`  
**Branch (working):** `feat/app-optimization` (aligned with `origin/dev` tip lineage)  
**Report started:** 2026-08-31  
**Last updated:** 2026-08-31

This file tracks what was done in the “absolute beast backend” workstream — separate from the backlog checklist in [`backend-beast-roadmap.md`](./backend-beast-roadmap.md) and the audit in [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md).

---

## How to read this report

| Status | Meaning |
| --- | --- |
| Done | Completed and verified in-repo |
| Blocked | Cannot finish without you (credentials / project / Docker) |
| Next | Immediate next step once unblocked |
| Open | Known remaining work (not started or only partially done) |

---

## Session overview

1. Mapped the full repo + all git branches; identified `main` as docs-only and `dev` / `feat/app-optimization` as the real backend.
2. Built / refined the beast roadmap checklist.
3. Executed roadmap **§1** (doc/path/env hygiene) end-to-end with double-check.
4. Started roadmap **§2** (hosted infrastructure): in-repo prep + critical PDF auth fix; hosted deploy blocked on project ref.

---

## Phase 0 — Project understanding (complete)

### Branch map (verified)

| Branch | Role |
| --- | --- |
| `main` / `origin/main` | Scaffold / docs-only init — **not** the product tip |
| `origin/staging-1.0.0` | Same as bare `main` — placeholder |
| `origin/feat/app-functioanlity` | Mid-lineage; superseded |
| `origin/dev` | Full backend tip (schema, EFs, docs) |
| `origin/feat/app-optimization` | Same tip lineage as `dev` (active working branch) |

### What already existed on the product tip

- PostgreSQL schema, RLS, Storage buckets (`covers`, `pdfs`, `avatars`)
- ~28 Edge Functions (catalog, library, PDF, webhook, admin)
- Admin CMS SQL RPCs/views
- Seed: categories + `premium_monthly` + local-only test users
- Docs: stack, schema, setup, API endpoints
- **No books/collections in seed** (catalog empty after reset)

### Companion FE reality

- Path: `D:\ilm-o-irfan-books-app` (not the old `D:\Projects\Ilm-o-Irfan-App-FE`)
- UI + mocks only — no Supabase / RevenueCat SDKs wired yet

---

## Phase 1 — Doc / path / env hygiene (Done)

**Roadmap:** §1  
**Goal:** Correct paths, honest docs, production-safe paywall example defaults.

### Completed

| Item | Files / notes |
| --- | --- |
| FE path → `D:\ilm-o-irfan-books-app` | `.cursor/rules/frontend-aligned-backend.mdc`, `.cursor/rules/DESCRIPTION.md`, `README.md` |
| BE path → `D:/ilm-o-irfan-books-app-BE` | `docs/setup-guide.md` (Path A + Path C `cd` examples) |
| Paywall-safe `.env.example` | Default `ALLOW_PDF_WITHOUT_ENTITLEMENT=false` + prod warning + Google placeholders |
| Setup-guide secrets | Example sets paywall **false**; open-paywall only as commented local option |
| Setup-guide inventory | Full ~28 EF surface; complete migration list through search/admin fixes |
| README honesty | Auth = email; Google when enabled; scripts list expanded |
| Stack checklist honesty | `docs/backend-stack.md` (BE) + FE copy synced — Google/RC/client marked partial |
| Empty migration | `20260802110539_new-migration.sql` kept with comment (history-safe) |
| Beast roadmap restored | `docs/backend-beast-roadmap.md` with §1 marked done |

### Double-check results

- Grep: no remaining `Projects\Ilm-o-Irfan-App-FE` / wrong BE path
- `ALLOW_PDF…=true` only in comments (how to enable for local)
- FE path exists on disk; `GOOGLE_CLIENT_*` names match `supabase/config.toml`

---

## Phase 2 — Hosted infrastructure prep (Partial — Done in-repo, Blocked on you)

**Roadmap:** §2  
**Goal:** Link → migrate → deploy all functions → secrets (paywall closed) → smoke.

### Environment check (shell)

| Check | Result |
| --- | --- |
| Branch | `feat/app-optimization` |
| Linked project (`.supabase/project-ref`) | **Missing** |
| Local `.env` | **Missing** |
| Supabase CLI | **2.116.0** available via `npx` |
| Docker | **Not installed** — local `supabase start` / Path C unavailable |

### Completed in-repo

| Item | Detail |
| --- | --- |
| Deploy checklist | [`docs/ops/deploy-checklist.md`](./ops/deploy-checklist.md) — steps A–I, no secrets in git |
| npm scripts | `link`, `functions:deploy`, `functions:list` in `package.json` |
| README scripts + link | Documents deploy checklist |
| Schema apply docs | `docs/schema.md` — canonical `db push`; pgAdmin list includes `08_search_views…` |
| Setup PDF access copy | Documents free vs premium book rules |

### Critical fix shipped with §2 prep (audit release blocker #1)

**Problem:** `get-signed-pdf` required an entitlement for **all** non-admin users, including free books (`is_premium = false`).

**Fix:** Entitlement check runs only when `books.is_premium === true`. Free published books open for any signed-in user. Admin + global bypass unchanged.

| Touched | Change |
| --- | --- |
| `supabase/functions/get-signed-pdf/index.ts` | Select `is_premium`; gate entitlement on premium only |
| `docs/api-endpoints.md` | Premium access section rewritten |
| `docs/setup-guide.md` | Access rules include free books |
| `scripts/e2e-endpoints.sh` | Free book → `signedUrl`; premium without entitlement → `PREMIUM_REQUIRED` |
| `docs/backend-audit-remaining-work.md` | Blockers #1 and #4 marked fixed; #3 docs marked updated |

### Blocked — needs you

1. Create staging (then production) Supabase project(s)  
2. Provide **project ref** (`https://<ref>.supabase.co`)  
3. `npx supabase login` on this machine  
4. Then: link → `db:push` → `functions:deploy` → secrets (`ALLOW_PDF…=false`) → first admin → smoke checks  

Optional later: install Docker Desktop for local Path C / e2e.

---

## Audit alignment

From [`backend-audit-remaining-work.md`](./backend-audit-remaining-work.md):

| Blocker | Status |
| --- | --- |
| #1 PDF free-book authorization | **Fixed** |
| #2 RevenueCat webhook idempotency / order-safety | **Open** |
| #3 Migration path docs | **Docs fixed**; live `db push` still needs project |
| #4 Production PDF bypass defaults | **Fixed** |

---

## Files touched (cumulative)

### Created

- `docs/backend-beast-roadmap.md`
- `docs/ops/deploy-checklist.md`
- `docs/backend-work-progress.md` (this report)

### Updated (high level)

- `.cursor/rules/frontend-aligned-backend.mdc`
- `.cursor/rules/DESCRIPTION.md`
- `.env.example`
- `README.md`
- `package.json`
- `docs/setup-guide.md`
- `docs/schema.md`
- `docs/api-endpoints.md`
- `docs/backend-stack.md` (+ FE mirror checklist)
- `docs/backend-audit-remaining-work.md`
- `supabase/migrations/20260802110539_new-migration.sql` (comment only)
- `supabase/functions/get-signed-pdf/index.ts`
- `scripts/e2e-endpoints.sh`

---

## Next actions

| # | Action | Owner |
| --- | --- | --- |
| 1 | Create Supabase project + send **project ref** | You |
| 2 | CLI login + link + `db:push` + deploy all EFs + closed-paywall secrets | Agent (after #1) |
| 3 | Promote first admin + smoke (`home-feed`, free/premium PDF) | Agent + you |
| 4 | Webhook idempotency (audit #2) | Agent |
| 5 | Content pipeline (collections seed, harden import, upload/publish) | Agent |
| 6 | Auth Google + deep links | You (Dashboard) + agent (docs/config) |
| 7 | Remaining API polish / admin EF wrappers / CI | Agent |

---

## Definition of done for current phase (§2)

§2 is **fully done** when:

- [ ] Staging project linked  
- [ ] All migrations applied  
- [ ] All Edge Functions deployed and listed  
- [ ] Secrets set with paywall closed  
- [ ] `app_settings.allow_pdf_without_entitlement = false`  
- [ ] First admin promoted and re-logged-in  
- [ ] Storage buckets verified  
- [ ] Smoke: free PDF opens; premium without entitlement → `PREMIUM_REQUIRED`  

Until the project ref arrives, §2 remains **prep-complete / deploy-blocked**.
