# Hosted deploy checklist (staging / production)

Use this after a Supabase project exists. **Never commit real secrets.**  
Canonical schema source: `supabase/migrations/` (prefer `db push` over pasting SQL).

Companion FE: `D:\ilm-o-irfan-books-app`  
FE handoff values: [`fe-handoff.md`](./fe-handoff.md)

---

## Recommended: one-pass script

```bash
cd D:/ilm-o-irfan-books-app-BE
npx supabase login   # or set SUPABASE_ACCESS_TOKEN

# Required in env / .env (gitignored):
#   SUPABASE_PROJECT_REF
#   REVENUECAT_WEBHOOK_AUTH          # or DEPLOY_ALLOW_PLACEHOLDER_RC=1 for staging
#   REVENUECAT_ENTITLEMENT_ID=premium
#   SIGNED_PDF_EXPIRES_IN=300

DEPLOY_SEED=1 npm run deploy:hosted
```

That runs: **link → db push → optional seed → functions deploy → secrets → unset dead PDF bypass**.

CI equivalent (manual only): Actions → **Deploy hosted (staging)** — needs repo secrets listed in [`env-matrix.md`](./env-matrix.md).

- [ ] `npm run deploy:hosted` exited 0
- [ ] `npx supabase functions list` shows all **58** functions

Manual A–D below is the same work if you prefer step-by-step.

---

## Prerequisites

- [ ] Supabase CLI available (`npx supabase --version`)
- [ ] Logged in: `npx supabase login` **or** `SUPABASE_ACCESS_TOKEN` set
- [ ] Project ref known (`https://YOUR_PROJECT_REF.supabase.co`)
- [ ] Branch to ship is checked out (`dev` / `feat/mobile-api-parity` / tagged release)
- [ ] `.env` from `.env.example` (gitignored) for local tooling only

Docker is **optional** (local Path C). Hosted deploy does not need Docker.

---

## A–D. Manual equivalent (optional)

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npm run db:push
DEPLOY_SEED=1 npx supabase db query --linked --file supabase/seed.sql   # optional
npm run functions:deploy
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer YOUR_SHARED_SECRET"
npx supabase secrets set REVENUECAT_ENTITLEMENT_ID="premium"
npx supabase secrets set SIGNED_PDF_EXPIRES_IN="300"
npx supabase secrets unset ALLOW_PDF_WITHOUT_ENTITLEMENT   # if present
```

Seed notes:

- Categories + collections + `premium_monthly` plan are safe on hosted.
- Local auth users in `seed.sql` are for Docker `db reset`. On hosted, **sign up real users** then promote admin (§F).

Verify migrations:

```sql
select to_regclass('public.revenuecat_events');
-- expect: revenuecat_events
```

Prefer **not** pasting SQL by hand. If you must, follow `docs/setup-guide.md` Option 2a (includes `20260905140000_restrict_covers_listing.sql`).

---

## E. Storage buckets

Created by migrations:

| Bucket | Public | Notes |
| --- | --- | --- |
| covers | yes | catalog images; FE uses `coverUrl` from APIs |
| pdfs | **no** | signed URL only via `get-signed-pdf` |
| avatars | no | `{user_id}/…` |

- [ ] Buckets present in Dashboard → Storage
- [ ] No anonymous read policy on `pdfs`

---

## F. Auth + first admin

**Now (email/password):**

1. Dashboard → Authentication → Providers → **Email** enabled.
2. Confirmations **On** for staging/production (Off only on local Docker).
3. Sign up the first admin (app or Dashboard → Users).
4. Promote:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_ADMIN_EMAIL';
```

5. Sign out and back in (JWT must refresh `app_metadata.app_role`).

- [ ] `entitlements-status` returns `isAdmin: true` and `canAccessPremium: true`

**Later (Google):** Dashboard Google provider + iOS/Android redirect / deep links when the FE ships Google login.

**Later (RevenueCat):** Point RC webhook at  
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook`  
with Authorization matching `REVENUECAT_WEBHOOK_AUTH`. Replace any staging placeholder.

**Later (catalog):** `BOOKS_DIR=… npm run books:import` then `admin_storage_audit()` clean. Seed alone is enough to prove deploy.

---

## G. Smoke checks

Automated public envelope checks (no Docker):

```bash
# SUPABASE_URL + SUPABASE_ANON_KEY in env / .env
npm run smoke:hosted
# optional: SUPABASE_USER_JWT=… for entitlements-status + profile-read
```

Manual / SQL:

```sql
select count(*) from public.books where is_published;
select code, is_active from public.plans;
```

- [ ] `npm run smoke:hosted` passes (or `home-feed` curl returns 200 `{ data }`)
- [ ] Free published book opens for signed-in user without entitlement *(needs catalog)*
- [ ] Premium book returns `PREMIUM_REQUIRED` without entitlement *(needs catalog)*
- [ ] Premium book opens with active entitlement or admin *(needs RC or admin)*
- [ ] Publishing without PDF → `PDF_NOT_IN_STORAGE`
- [ ] `POST reading-progress { book_id, progress }` alone does not reset `current_page`
- [ ] CMS edit attributes admin email in `admin-audit-log`
- [ ] `GET books-list?page=100000` → `PAGE_OUT_OF_RANGE`
- [ ] `admin-storage-audit` clean after import
- [ ] `npx supabase db advisors` reviewed before launch

---

## H. Staging vs production

| | Staging | Production |
| --- | --- | --- |
| Separate Supabase project | required | required |
| Paywall | closed — no bypass in code | closed |
| Catalog | sample OK | real titles |
| RevenueCat | sandbox | production |
| Secrets | never reuse across envs | rotated |

- [ ] Staging: deploy script + smoke free path
- [ ] Production: same checklist; **different** `REVENUECAT_WEBHOOK_AUTH`

---

## I. Private ops note (offline / password manager)

- Staging + production project refs
- Webhook URLs
- Where `REVENUECAT_WEBHOOK_AUTH` lives
- First admin email
- FE handoff: `SUPABASE_URL` + anon key (see [`fe-handoff.md`](./fe-handoff.md))

---

## Blocked without you

1. Create Supabase project(s)  
2. Provide `SUPABASE_PROJECT_REF` + CLI login / access token  
3. Real RC / Google / book files when those paths go live  

Repo path after you send the ref: `npm run deploy:hosted` → `npm run smoke:hosted` → §F admin → FE handoff.
