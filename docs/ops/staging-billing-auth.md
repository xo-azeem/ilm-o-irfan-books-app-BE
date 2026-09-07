# Staging RevenueCat + Google (ops)

Staging project ref: `rwnmckrepvycydmtgvcq`  
API URL: `https://rwnmckrepvycydmtgvcq.supabase.co`

## RevenueCat

1. Create a RevenueCat project (or use an existing sandbox project).
2. Entitlement id must be **`premium`** (matches `REVENUECAT_ENTITLEMENT_ID`).
3. Map App Store / Play products to plan `premium_monthly` (`revenuecat_product_id`).
4. Webhook URL:

```text
https://rwnmckrepvycydmtgvcq.supabase.co/functions/v1/revenuecat-webhook
```

5. Authorization header must match the Edge secret `REVENUECAT_WEBHOOK_AUTH`.  
   Staging may currently use `Bearer STAGING_PLACEHOLDER_NOT_LIVE` — replace before any real sandbox events:

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer YOUR_REAL_SHARED_SECRET" --project-ref rwnmckrepvycydmtgvcq
```

6. **`app_user_id` must be the Supabase Auth user UUID** (not email, not RC anonymous id).  
   The webhook rejects non-UUID / unknown profiles with `400 USER_NOT_FOUND`.  
   In the RN app: `Purchases.logIn(supabaseUser.id)` after Auth sign-in.
7. Sandbox matrix: initial purchase, renew, cancel, billing_issue, expire, product change → check `entitlements-status`.

### Manual comps (no RC)

Admin only — `POST /functions/v1/admin-set-entitlement`:

```json
{
  "userId": "<auth-uuid>",
  "status": "active",
  "planId": "<premium_monthly uuid or omit to keep current>"
}
```

Writes `store = 'promotional'`. A later real RevenueCat event for the same user **can overwrite** this row (idempotent ledger). Tell support when a comp is temporary.

Rotate webhook auth: [`../runbooks/secret-rotation.md`](../runbooks/secret-rotation.md).

### Plan price display (FE)

| Source | Meaning |
| --- | --- |
| `plans.price_cents` + `currency` (e.g. `149900` + `PKR`) | **Catalog / marketing** price from our DB |
| App Store / Play localized price via RevenueCat | **What the user is charged** |

Do **not** invent `$` from `price_cents / 100` for IAP buttons. Use RC/package price for checkout UI; use `price_cents` for About / comparison copy if needed, and label the currency.

Client must **never** write `entitlements` (RLS + contract).

## Google OAuth

1. Google Cloud Console → OAuth client (iOS + Android / Web as needed).
2. Supabase Dashboard → Authentication → Providers → Google → enable + client id/secret.
3. Add redirect / deep-link URLs for the RN app (not only localhost).  
   Staging `site_url` is already `https://rwnmckrepvycydmtgvcq.supabase.co` with localhost allow-listed. When the app scheme exists (e.g. `ilmoirfan://`), PATCH `uri_allow_list` or use Dashboard → URL Configuration.
4. Optional local: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and enable in `supabase/config.toml`.

Helper: `node scripts/configure-hosted-auth-uris.mjs` (site_url + allow list). Raising `rate_limit_email_sent` needs **custom SMTP**.

## Auth email / password reset

- Confirmations stay **On** for staging (`mailer_autoconfirm=false`).
- Built-in Supabase mail: `rate_limit_email_sent` stays at **2/hour** until custom SMTP is configured.
- Seed accounts (`admin@gmail.com` / `test@gmail.com`) may be rejected by GoTrue recovery (`email_address_invalid`) depending on provider rules — use a real inbox for recovery QA, or configure SMTP + a brand domain.
- FE Forgot Password: call Supabase Auth `resetPasswordForEmail` (no custom Edge Function).

## Already verified on staging

- Email Auth + seed admin/test (`Password123!`)
- Sample + catalog books in Storage; `admin-storage-audit` clean (no broken/orphans)
- Cover public URLs resolve (`npm run smoke:covers`)
- `get-signed-pdf`: free OK, promotional premium OK, admin OK, unentitled → `PREMIUM_REQUIRED`
- Auth `site_url` + URI allow list pointed at the project (not only localhost)
