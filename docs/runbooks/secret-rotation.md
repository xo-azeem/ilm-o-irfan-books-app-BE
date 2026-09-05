# Runbook: secret rotation

Run this on a schedule, and immediately if a key was pasted anywhere it should not have
been — a ticket, a screenshot, a commit, a chat message.

## What exists, and what leaking it costs

| Secret | Where it lives | Blast radius if leaked |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Function secrets only | **Total.** Bypasses every RLS policy. Never in the app, never in the repo. |
| `SUPABASE_ANON_KEY` | The mobile app | Low by design — RLS is what protects data. Rotating it ships a new app build. |
| `REVENUECAT_WEBHOOK_AUTH` | Function secrets + RevenueCat dashboard | An attacker could forge entitlements. Rotate on any suspicion. |
| Google OAuth client secret | Supabase Dashboard + Google Cloud | Sign-in impersonation. |
| Database password | Dashboard, CLI, any direct psql access | Total. |

The service-role key is the one that ends a company. It exists in exactly one place: the
Edge Function secrets. If you find it anywhere else — an app bundle, a `.env` in a commit,
a doc — treat that as a live incident and rotate before doing anything else.

## Rotate `REVENUECAT_WEBHOOK_AUTH`

The webhook compares the incoming `Authorization` header to this value exactly, so the two
sides must change together. There is a gap while they disagree, and RevenueCat retries for
24 hours, so a short gap costs nothing.

1. Generate a value:
   ```bash
   openssl rand -base64 32
   ```
2. Set it on the project:
   ```bash
   npx supabase secrets set REVENUECAT_WEBHOOK_AUTH='<new-value>' --project-ref <ref>
   ```
3. Update the same value in RevenueCat → Integrations → Webhooks → Authorization header.
4. Send a test event from RevenueCat and confirm a `200` in the function logs.
5. If any events failed during the gap, resend them — the event ledger makes that safe.

Staging and production must not share this value.

## Rotate the service-role key

1. Dashboard → Project Settings → API → **Generate new service_role key**.
2. Re-set it wherever functions read it:
   ```bash
   npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY='<new-key>' --project-ref <ref>
   ```
   On a hosted project the platform injects `SUPABASE_SERVICE_ROLE_KEY` automatically; an
   explicit secret is only needed if one was set to override it.
3. Redeploy the functions so they pick up the new value:
   ```bash
   npx supabase functions deploy --project-ref <ref>
   ```
4. Update anything else holding it: CI secrets, the import script's `.env`, ops tooling.
5. Revoke the old key in the Dashboard.
6. Smoke-test an admin endpoint and `get-signed-pdf` — those are the two paths that use it.

## Rotate the anon key

Only worth doing if the key is being abused for volume, since it grants nothing RLS does
not already allow. It requires a new app release, so treat it as a release task rather than
an incident response.

## After any rotation

- `npm run ci:static` — the secret scan fails the build on a key-shaped string in tracked
  source, docs, SQL, or workflows.
- Check the git history for the leaked value; rotating does not remove it from history.
  If it was pushed, rotate first, then decide about rewriting history.
- Record what was rotated and when. `admin_audit_log` covers data changes, not secrets.

## Preventing the next one

- `.env` is gitignored and the CI secret scan is not advisory — it fails the build.
- The mobile app gets the anon key and a user JWT. Nothing else, ever.
- Staging and production hold different secrets, so a staging leak is not a production one.
