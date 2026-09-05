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

**Public:** `home-feed`, `books-list`, `books-search`, `book-detail`, `categories-list`, `collections-list`, `collection-books`, `plans-list`

**Authenticated** (`Authorization: Bearer <user JWT>` + `apikey: <anon>`):  
`get-signed-pdf`, `reading-progress`, `library-overview`, `wishlist-list`, `wishlist-toggle`, `downloads-list`, `downloads-create`, `highlights-list`, `highlights-upsert`, `highlights-delete`, `profile-read`, `profile-update`, `avatar-upload-url`, `entitlements-status`

**Not called by the app:** `revenuecat-webhook`, all `admin-*`, deprecated `signed-pdf` (410).

Contract details: [`docs/mobile-contract.md`](../mobile-contract.md).

## After backend deploy

1. Operator runs `npm run deploy:hosted` + `npm run smoke:hosted` ([deploy-checklist.md](./deploy-checklist.md)).
2. Copy URL + anon key into the FE env (never commit secrets).
3. Wire Supabase Auth + Edge Function client on the FE side.
4. Premium path needs RevenueCat SDK + live webhook; until then gate UI on `entitlements-status` and treat purchases as unavailable.
