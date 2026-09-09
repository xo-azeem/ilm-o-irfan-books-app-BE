# Frontend handoff (hosted backend)

Give the mobile team **only** these values from Dashboard → **Settings → API**:

| Variable | In the app? | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Public; RLS + Edge auth protect data |
| RevenueCat **public** SDK keys (iOS/Android) | yes, when IAP ships | Not the webhook secret |
| `SUPABASE_SERVICE_ROLE_KEY` | **never** | Server / import / CMS tooling only |
| `REVENUECAT_WEBHOOK_AUTH` | **never** | Function secret + RC Dashboard only |

Auth for launch: **email/password** via Supabase Auth SDK (not an Edge Function).  
Google OAuth is Dashboard + deep links later — not required for the first hosted connect.

## Edge Functions the app calls

**Public:**  
`home-feed`, `carousel-list`, `trending-weekly`, `books-list`, `books-search`, `book-detail`, `categories-list`, `collections-list`, `collection-books`, `plans-list`

**Authenticated** (`Authorization: Bearer <user JWT>` + `apikey: <anon>`):  
`get-signed-pdf`, `reading-progress`, `library-overview`, `wishlist-list`, `wishlist-toggle`, `downloads-list`, `downloads-create`, `highlights-list`, `highlights-upsert`, `highlights-delete`, `profile-read`, `profile-update`, `avatar-upload-url`, `entitlements-status`, `recommendations`

**Not called by the app:** `revenuecat-webhook`, all `admin-*`, deprecated `signed-pdf` (410).

### Premium / reader rules (do not drift)

- Gate UI and Read on **`canAccessPremium`** from `entitlements-status` (not `isActive`, not `books.is_premium`).
- Access rule is `entitlement_has_access(status, expires_at)` — trial / cancelled / grace / billing_issue can still read while paid through.
- `get-signed-pdf` returns `access.{expiresAt,secondsRemaining,serverTime,reason}` to re-anchor the countdown.
- Catalogue is **subscription-only** — every published title needs membership (or admin).

Contract details: [`docs/mobile-contract.md`](../mobile-contract.md).  
Frozen envelopes: [`docs/fixtures/`](../fixtures/).

## Billing contract (Apple / Google via RevenueCat)

In-app subscription checkout is FE + RevenueCat. The backend only accepts the webhook and exposes status.

| Rule | Detail |
| --- | --- |
| `app_user_id` | Must be the **Supabase Auth user UUID** (`Purchases.logIn(user.id)`). Email / `$RCAnonymousID` → `400 USER_NOT_FOUND` / invalid event |
| Entitlement id | `premium` (`REVENUECAT_ENTITLEMENT_ID`) |
| Plan | `premium_monthly`; webhook matches `event.product_id` → `plans.revenuecat_product_id`, else falls back to that plan code |
| Stores | `APP_STORE` / `MAC_APP_STORE` → `app_store`; `PLAY_STORE` → `play_store` |
| After purchase | Refresh **`entitlements-status`** (and Realtime `entitlement_changed`). Never write `entitlements` from the client |
| Prices | Show RC/package localized price on Subscribe; DB `plans.price_cents` is catalog copy only |
| Secrets | Public RC SDK keys → FE env. `REVENUECAT_WEBHOOK_AUTH` → Edge secret + RC dashboard only |

Sample webhook bodies:  
`docs/fixtures/revenuecat-webhook.app-store.initial-purchase.request.json`,  
`docs/fixtures/revenuecat-webhook.play-store.initial-purchase.request.json`.

Ops checklist: [`staging-billing-auth.md`](./staging-billing-auth.md).

## After backend deploy

1. Operator runs `npm run deploy:hosted` + `npm run smoke:hosted` ([deploy-checklist.md](./deploy-checklist.md)).
2. Copy URL + anon key into the FE env (never commit secrets).
3. Wire Supabase Auth + Edge Function client on the FE side.
4. Premium path needs RevenueCat SDK + live webhook; until then gate UI on `entitlements-status` and treat purchases as unavailable (promo/admin comps for staging).
