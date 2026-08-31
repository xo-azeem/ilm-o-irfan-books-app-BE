# Hosted deploy checklist (staging / production)

Use this after a Supabase project exists. **Never commit real secrets.**  
Canonical schema source: `supabase/migrations/` (prefer `db push` over pasting SQL).

Companion FE: `D:\ilm-o-irfan-books-app`

---

## Prerequisites

- [ ] Supabase CLI available (`npx supabase --version`)
- [ ] Logged in: `npx supabase login`
- [ ] Project ref known (URL subdomain: `https://YOUR_PROJECT_REF.supabase.co`)
- [ ] Local branch has the code you intend to ship (`feat/app-optimization` / `dev`)
- [ ] `.env` created from `.env.example` (gitignored) with real keys for your machine only

Docker is **optional** (local Path C). Hosted Path A does not need Docker.

---

## A. Link project

```bash
cd D:/ilm-o-irfan-books-app-BE
npx supabase link --project-ref YOUR_PROJECT_REF
```

- [ ] Link succeeded (creates local `.supabase/` — gitignored)

---

## B. Apply migrations

```bash
npm run db:push
```

- [ ] All migrations applied (including app_settings, admin CMS v2, search views)
- [ ] Prefer **not** pasting SQL by hand unless emergency; if you must, follow the full list in `docs/setup-guide.md` Option 2a

Seed on hosted (categories + plan only — **no** local test passwords unless you intentionally run seed):

```bash
npx supabase db query --file supabase/seed.sql
```

Note: `seed.sql` local auth users are intended for Docker `db reset`. On hosted, create real users via Auth signup, then promote admin with SQL.

- [ ] Categories + `premium_monthly` plan present
- [ ] `app_settings` row `id = 1` exists with `allow_pdf_without_entitlement = false`
- [ ] Migration `20260831140000_revenuecat_events_idempotency.sql` applied (`revenuecat_events` table exists)

```sql
select allow_pdf_without_entitlement from public.app_settings where id = 1;
-- expect: false
select to_regclass('public.revenuecat_events');
-- expect: revenuecat_events
```

---

## C. Deploy every Edge Function

```bash
npm run functions:deploy
```

Or: `npx supabase functions deploy`

Deploy list (must all succeed):

| Public | User | Admin | Special |
| --- | --- | --- | --- |
| home-feed | profile-read | admin-books | get-signed-pdf |
| books-list | profile-update | admin-book-create | signed-pdf (410) |
| book-detail | reading-progress | admin-book-update | revenuecat-webhook |
| books-search | wishlist-list | admin-book-delete | |
| categories-list | wishlist-toggle | admin-authors | |
| collections-list | downloads-list | admin-author-create | |
| plans-list | downloads-create | admin-author-update | |
| | highlights-list | admin-author-delete | |
| | highlights-upsert | admin-bulk-update-books | |
| | highlights-delete | admin-set-book-relations | |
| | library-overview | admin-set-collection-books | |
| | entitlements-status | admin-reorder | |
| | | admin-set-entitlement | |
| | | admin-set-user-role | |
| | | admin-user-detail | |
| | | admin-storage-audit | |
| | | admin-delete-storage-object | |
| | | admin-dashboard-stats | |
| | | admin-categories | |
| | | admin-collections | |
| | | admin-users | |
| | | admin-analytics | |
| | | admin-settings | |

- [ ] `npx supabase functions list` shows all expected functions

---

## D. Secrets (paywall CLOSED on public projects)

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer YOUR_SHARED_SECRET"
npx supabase secrets set REVENUECAT_ENTITLEMENT_ID="premium"
npx supabase secrets set SIGNED_PDF_EXPIRES_IN="300"
npx supabase secrets set ALLOW_PDF_WITHOUT_ENTITLEMENT="false"
```

- [ ] `ALLOW_PDF_WITHOUT_ENTITLEMENT=false` on staging public and production
- [ ] Webhook auth matches RevenueCat Dashboard Authorization header
- [ ] Service role / anon keys only in Dashboard / local `.env` — never in the RN app except anon

---

## E. Storage buckets

Confirm buckets exist with expected policies (created by migrations):

| Bucket | Public | Notes |
| --- | --- | --- |
| covers | yes | catalog images |
| pdfs | **no** | signed URL only via `get-signed-pdf` |
| avatars | no | `{user_id}/…` |

- [ ] Buckets present in Dashboard → Storage
- [ ] No anonymous read policy on `pdfs`

---

## F. First admin

1. Sign up in the app (or Dashboard → Authentication → Users).
2. Run:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_ADMIN_EMAIL';
```

3. Sign out and sign back in (JWT must refresh `app_metadata.app_role`).

- [ ] `entitlements-status` returns `isAdmin: true` and `canAccessPremium: true`
- [ ] Admin can open unpublished draft PDFs via `get-signed-pdf`

---

## G. Smoke checks

```sql
select count(*) from public.books where is_published;
select code, is_active from public.plans;
select allow_pdf_without_entitlement from public.app_settings where id = 1;
```

```bash
# Replace URL, anon key, and user JWT
curl -s "$SUPABASE_URL/functions/v1/home-feed" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

- [ ] `home-feed` returns 200 envelope
- [ ] Free published book (`is_premium=false`) opens for signed-in user without entitlement
- [ ] Premium book returns `PREMIUM_REQUIRED` without entitlement
- [ ] Premium book opens with active entitlement or admin

---

## H. Staging vs production

| | Staging | Production |
| --- | --- | --- |
| Separate Supabase project | required | required |
| Paywall bypass env | **false** | **false** |
| Catalog data | sample OK | real titles only |
| RevenueCat | sandbox | production |

- [ ] Staging project created and checklist A–G done
- [ ] Production project created and checklist A–G done (do not reuse staging secrets)

---

## I. Private ops note (keep offline / password manager)

Record outside git:

- Staging project ref + webhook URL
- Production project ref + webhook URL
- Where `REVENUECAT_WEBHOOK_AUTH` is stored
- First admin email

Webhook URL shape:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook`

---

## Blocked without you

These cannot be finished from the repo alone:

1. Create the Supabase project(s) in the Dashboard  
2. Provide `YOUR_PROJECT_REF` (and ensure CLI login works on this machine)  
3. Paste real secrets into Dashboard / `supabase secrets set`  

Once you send the **project ref**, the next step is: link → `db:push` → `functions:deploy` → secrets → smoke checks.
