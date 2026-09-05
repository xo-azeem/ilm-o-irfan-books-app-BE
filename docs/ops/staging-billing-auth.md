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

6. Set RevenueCat `app_user_id` = Supabase Auth user UUID.
7. Sandbox matrix: initial purchase, renew, cancel, billing_issue, expire, product change → check `entitlements-status`.

Manual comps (no RC): `POST /functions/v1/admin-set-entitlement` as admin (`store = promotional`).

## Google OAuth

1. Google Cloud Console → OAuth client (iOS + Android / Web as needed).
2. Supabase Dashboard → Authentication → Providers → Google → enable + client id/secret.
3. Add redirect / deep-link URLs for the RN app (not only `127.0.0.1:3000`).
4. Optional local: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and enable in `supabase/config.toml`.

## Already verified on staging

- Email Auth + seed admin/test (`Password123!`)
- Sample + catalog books in Storage; `admin-storage-audit` clean (no broken/orphans)
- `get-signed-pdf`: free OK, promotional premium OK, admin OK, unentitled → `PREMIUM_REQUIRED`
