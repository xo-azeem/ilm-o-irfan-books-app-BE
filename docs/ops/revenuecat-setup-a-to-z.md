# RevenueCat + Apple + Google — A to Z setup (Ilm o Irfan)

**Goal:** One Premium monthly subscription that users buy in the app via the App Store / Play sheet; RevenueCat validates the receipt and our webhook unlocks `canAccessPremium`.

**Do not skip order.** Store products before RC offerings; webhook secret before sandbox purchases; public SDK keys only in the app.

Staging Supabase: `https://rwnmckrepvycydmtgvcq.supabase.co`  
Webhook: `https://rwnmckrepvycydmtgvcq.supabase.co/functions/v1/revenuecat-webhook`  
App Android id: `com.ilmoirfanapp`  
App iOS bundle id: **set a real id before App Store Connect** (repo still has the RN example placeholder — fix first).

---

## Fatal mistakes (read once)

| Mistake | What breaks |
| --- | --- |
| `Purchases.logIn(email)` or anonymous id | Webhook returns `400 USER_NOT_FOUND` / invalid event — **must be Supabase Auth UUID** |
| Entitlement id ≠ `ilm_o_irfan_pro` (the value of `REVENUECAT_ENTITLEMENT_ID`) | Purchases succeed in store but our gate never sees the entitlement |
| Putting `REVENUECAT_WEBHOOK_AUTH` or secret API key in the React Native app | Anyone can forge entitlements |
| Leaving webhook auth as `STAGING_PLACEHOLDER_NOT_LIVE` and sending real events | Auth failures / ignored events |
| Sharing the same webhook secret across staging and production | Cross-env spoofing / chaos |
| Using DB `plans.price_cents` as the charge amount | Wrong currency/amount on the button — use RC `priceString` |
| Client writing to `entitlements` | Blocked by RLS; never do this |
| Testing IAP with a normal Apple ID on a production build | Use **Sandbox** Apple ID / Play license testers |
| Creating RC offerings before store products exist | Empty offerings → “No subscription package” |
| iOS still on `org.reactjs.native.example…` in App Store Connect | App / products won’t match the binary |

---

## Phase 0 — Accounts you must already have

Check each box before Phase 1:

- [ ] **Apple Developer Program** (paid) — for App Store Connect subscriptions  
- [ ] **Google Play Console** (developer account, $25 one-time) — for Play subscriptions  
- [ ] Team email for **RevenueCat** (free to start) — [app.revenuecat.com](https://app.revenuecat.com)  
- [ ] Access to staging Supabase project `rwnmckrepvycydmtgvcq` (Dashboard + CLI linked)  
- [ ] FE branch with Purchases SDK (`feat/revenuecat-iap` / merged)  

You do **not** need a paid RevenueCat plan under ~$2.5k MTR.

---

## Phase 1 — Fix the iOS bundle id (before App Store)

1. Pick a stable id, e.g. `com.ilmoirfanapp` (match Android) or `com.ilmoirfan.books`.  
2. In Xcode: target → Signing & Capabilities → Bundle Identifier.  
3. Confirm `ios/.../project.pbxproj` no longer contains `org.reactjs.native.example`.  
4. **Never change this again** after products are created.

Write the chosen id here: `________________`

---

## Phase 2 — App Store Connect (Apple)

1. [App Store Connect](https://appstoreconnect.apple.com) → My Apps → create the app (or open existing) with the **exact** bundle id from Phase 1.  
2. **Agreements:** Paid Applications agreement + banking/tax must be Active (subscriptions fail otherwise).  
3. Features → **Subscriptions** → create a **Subscription Group** (e.g. `premium`).  
4. Add a subscription:
   - Reference name: `Premium Monthly`
   - Product ID: pick once, e.g. `premium_monthly` or `com.ilmoirfanapp.premium.monthly`  
     **This string is forever** — copy it exactly.
   - Duration: 1 month  
   - Price: set for your markets (e.g. PKR tier)  
5. Add localization (display name + description).  
6. For sandbox: Users and Access → **Sandbox** → Testers → add a Sandbox Apple ID (not your real Apple ID).  

Write Apple Product ID here: `________________`

---

## Phase 3 — Google Play Console (Android)

1. [Play Console](https://play.google.com/console) → app with application id **`com.ilmoirfanapp`**.  
2. Monetize → Products → **Subscriptions** → Create subscription.  
3. Product id: preferably **same string as Apple** if Play allows; if not, note both.  
4. Base plan: auto-renewing monthly; set price.  
5. Activate the base plan.  
6. License testing: Setup → License testing → add Gmail tester accounts.  
7. You need an **internal testing** (or closed) track build with Billing permission for real device sandbox buys.  

Write Play Product ID here: `________________`

---

## Phase 4 — Create the RevenueCat project

1. Sign up / log in at [app.revenuecat.com](https://app.revenuecat.com).  
2. **Create project** → name: `Ilm o Irfan` (or `Ilm o Irfan Staging`).  
3. Add apps:
   - **iOS** → bundle id = Phase 1 id  
   - **Android** → package = `com.ilmoirfanapp`  
4. Connect stores when prompted:
   - Apple: App Store Connect API key / In-App Purchase key (follow RC’s current UI)  
   - Google: service account JSON with Play access (RC docs)  
5. **Entitlements** → New → Identifier must be exactly:

```text
ilm_o_irfan_pro
```

   (Matches `REVENUECAT_ENTITLEMENT_ID` on Supabase.)

6. **Products** → import / add the App Store + Play product ids from Phases 2–3.  
7. Attach **both** products to entitlement `ilm_o_irfan_pro`.  
8. **Offerings** → create/edit **Current** offering → add a **Monthly** package that points at those products.  
9. **API keys** → copy:
   - iOS **public** SDK key (`appl_…`)  
   - Android **public** SDK key (`goog_…`)  
   Never put the **Secret** key in the mobile app.

Write keys into FE `.env` only (gitignored):

```env
REVENUECAT_API_KEY_IOS=appl_...
REVENUECAT_API_KEY_ANDROID=goog_...
```

Rebuild the native app after changing keys.

---

## Phase 5 — Webhook (staging Supabase)

1. Generate a long random secret, e.g.:

```bash
# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

2. Set Edge secret (**include the `Bearer ` prefix** if that’s how you configure RC Authorization):

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_AUTH="Bearer YOUR_LONG_SECRET" --project-ref rwnmckrepvycydmtgvcq
npx supabase secrets set REVENUECAT_ENTITLEMENT_ID="ilm_o_irfan_pro" --project-ref rwnmckrepvycydmtgvcq
```

3. In RevenueCat → Project → **Integrations / Webhooks**:
   - URL: `https://rwnmckrepvycydmtgvcq.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization: **exactly** the same string as `REVENUECAT_WEBHOOK_AUTH` (including `Bearer `)
   - Send all subscriber events (at least INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE)

4. Use RC’s “Send test” only after the secret matches — expect `200` with our JSON envelope.

5. Redeploy the webhook function if it was never deployed with current code:

```bash
npx supabase functions deploy revenuecat-webhook --project-ref rwnmckrepvycydmtgvcq
```

---

## Phase 6 — Align Postgres plan product ids

On staging SQL (Dashboard → SQL):

```sql
update public.plans
set
  revenuecat_product_id = 'SHARED_OR_PRIMARY_SKU',
  app_store_product_id = 'APPLE_PRODUCT_ID',
  play_store_product_id = 'PLAY_PRODUCT_ID'
where code = 'premium_monthly';

select code, revenuecat_product_id, app_store_product_id, play_store_product_id
from public.plans
where code = 'premium_monthly';
```

Apple and Play product ids often **differ**. The webhook matches `event.product_id`
against all three columns (store-preferred order) and falls back to plan code
`premium_monthly` if nothing matches.

**Apple Pay / Google Pay:** payment methods inside the App Store / Play purchase
sheet — not separate products, SKUs, or Edge Functions.
---

## Phase 7 — App identity (already coded — verify)

In the RN app (already on `feat/revenuecat-iap`):

1. After sign-in, `Purchases.logIn(supabaseUser.id)` runs — **UUID only**.  
2. Subscribe uses offerings → native sheet.  
3. After purchase, app refreshes `entitlements-status` — it does **not** trust RC alone for PDF unlock.

Confirm in RC Customer / debugger that `App User ID` equals the Supabase `auth.users.id` for your test account.

---

## Phase 8 — First sandbox purchase (Android or iOS)

1. Sign into the app with a **real staging Supabase user** (not anonymous).  
2. Note their UUID: Profile / Dashboard Auth → Users.  
3. Device:
   - iOS: Settings → App Store → Sandbox Account  
   - Android: license tester Google account on device  
4. Profile → Subscription → **Subscribe** → complete the sheet.  
5. Within seconds, check:

```sql
select status, store, expires_at, revenuecat_entitlement_id
from public.entitlements
where user_id = 'PASTE_SUPABASE_USER_UUID';

select id, event_type, event_timestamp
from public.revenuecat_events
where user_id = 'PASTE_SUPABASE_USER_UUID'
order by event_timestamp desc
limit 5;
```

6. App: `canAccessPremium` true → open a PDF.  

If purchase succeeds but entitlement stays false: check webhook logs (Supabase Functions → `revenuecat-webhook`), usually auth mismatch or wrong `app_user_id`.

---

## Phase 9 — Short event matrix

| Event | Expect |
| --- | --- |
| INITIAL_PURCHASE | `status=active`, store `app_store` or `play_store` |
| RENEWAL | still `active`, later `expires_at` |
| CANCELLATION (paid through) | `cancelled`, still can read until `expires_at` |
| BILLING_ISSUE | `billing_issue`, access while paid through |
| EXPIRATION | `expired`, PDF → `PREMIUM_REQUIRED` |

---

## Phase 10 — Production later (do not mix with staging)

- Separate RC production keys **or** carefully separated apps  
- **Different** `REVENUECAT_WEBHOOK_AUTH`  
- Webhook URL → production Supabase project  
- Never reuse staging secret  

---

## Quick “where secrets live”

| Secret | Where |
| --- | --- |
| `appl_…` / `goog_…` public keys | FE `.env` only |
| `REVENUECAT_WEBHOOK_AUTH` | Supabase Edge secrets + RC webhook config |
| RC Secret API key | Server/dashboard only — **not** in the app |
| Play service account JSON | RC / ops vault — **not** in git |
| App Store Connect API key | RC / ops vault — **not** in git |

---

## Related docs

- [`staging-billing-auth.md`](./staging-billing-auth.md)  
- [`fe-handoff.md`](./fe-handoff.md)  
- FE [`docs/staging-connect.md`](../../../Ilm-o-Irfan-App-FE/docs/staging-connect.md)  
