# Security hardening notes (staging)

## Screen capture (mobile app)

| Platform | Behavior |
| --- | --- |
| **Android** | `FLAG_SECURE` on the main activity — blocks screenshots, recents thumbnails, and most screen recordings |
| **iOS** | Full still-screenshot blocking is **not** available from Apple; the app blacks out the UI while `UIScreen.isCaptured` (AirPlay / screen recording) |

Rebuild the native app after pulling FE changes.

## Edge Function secrets allowlist

Only these should be set as **custom** Edge secrets (via `npm run deploy:hosted`):

- `REVENUECAT_WEBHOOK_AUTH`
- `REVENUECAT_ENTITLEMENT_ID`
- `SIGNED_PDF_EXPIRES_IN`

The platform injects `SUPABASE_*`. Never run `supabase secrets set --env-file .env` — that can upload `DATABASE_URL` / `PGPASSWORD` into the function runtime.

`deploy:hosted` unsets `DATABASE_URL`, `PG*`, and `ALLOW_PDF_WITHOUT_ENTITLEMENT` after each deploy.

## Webhook

- Timing-safe Authorization compare
- 256 KiB body cap
- No CORS (server-to-server only)
- Ledger duplicate retries re-apply if entitlement never committed

## Client data minimization

`entitlements-status` never returns `raw_event` (full RevenueCat payload).

## Ops after secret exposure

If DB password or service_role was ever pasted into chat or pushed to Edge secrets: rotate in Dashboard, update local `.env` only.
