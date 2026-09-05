# Runbook: webhook down / entitlement drift

**Severity:** high — people who paid cannot read what they paid for.

## Symptom

A purchase completes in the store and in RevenueCat, but `entitlements-status` still reports
`isActive: false`, or a cancellation never takes effect.

## The pipeline

```
Store purchase → RevenueCat → POST /functions/v1/revenuecat-webhook
  → revenuecat_events (idempotency ledger, unique event id)
  → apply_revenuecat_entitlement() (skips events older than the stored one)
  → entitlements
```

Two properties matter when reading the evidence:

- **Duplicates are a success case.** A replayed event returns `200 { duplicate: true }`.
  RevenueCat retries on any non-2xx, so this is normal traffic, not a fault.
- **Out-of-order events are ignored, not applied.** A RENEWAL that arrives after the
  CANCELLATION it precedes returns `200 { stale: true, ignored: true }`.

## Triage, in order

### 1. Did the event reach us at all?

RevenueCat Dashboard → Integrations → Webhooks → delivery history. Then:

```bash
npx supabase functions logs revenuecat-webhook --project-ref <ref>
```

| What you see | Cause | Fix |
| --- | --- | --- |
| No delivery attempts | URL wrong in RevenueCat | Point it at `https://<ref>.supabase.co/functions/v1/revenuecat-webhook` |
| `401 WEBHOOK_AUTH_FAILED` | `Authorization` header does not match `REVENUECAT_WEBHOOK_AUTH` | Re-set both sides; see [secret-rotation.md](./secret-rotation.md) |
| `500 WEBHOOK_CONFIG_ERROR` | The secret is not set on the project at all | `npx supabase secrets set REVENUECAT_WEBHOOK_AUTH=... --project-ref <ref>` |
| `400 INVALID_WEBHOOK_EVENT` | Missing `id`, `type`, or `event_timestamp_ms` | Usually a sandbox payload; check the raw body in the log |
| `400 USER_NOT_FOUND` | `app_user_id` is not a Supabase Auth UUID | See step 2 |

### 2. Is `app_user_id` the Supabase user id?

This is the single most common integration fault. The app must call
`Purchases.logIn(session.user.id)` with the Supabase Auth UUID. If it does not,
RevenueCat sends `$RCAnonymousID:...` and the webhook rejects it with `USER_NOT_FOUND`,
because there is no safe way to guess who the purchase belongs to.

```sql
select id, event_type, raw_event -> 'event' ->> 'app_user_id' as app_user_id
from public.revenuecat_events
order by created_at desc
limit 20;
```

Fix in the app. Then grant the affected purchases manually (step 4) — RevenueCat will not
resend events that were already answered with a 4xx.

### 3. Did the event land but not apply?

```sql
select
  e.id, e.event_type, e.event_timestamp,
  ent.status, ent.expires_at, ent.last_revenuecat_event_id, ent.last_revenuecat_event_at
from public.revenuecat_events e
left join public.entitlements ent on ent.user_id = e.user_id
where e.user_id = '<user-id>'
order by e.event_timestamp desc;
```

If `last_revenuecat_event_at` is **newer** than the event you are chasing, it was skipped as
stale, which is correct: a later event already decided the state. If the state it decided is
wrong, the fault is upstream in the event stream, not here.

### 4. Restore access by hand

```
POST /functions/v1/admin-set-entitlement
{ "userId": "<user-id>", "status": "active", "expiresAt": "2026-10-05T00:00:00Z" }
```

This writes `store = 'promotional'`. Say so to the user: **the next real RevenueCat event
for that account overwrites it**, so a comp is a bridge, not a fix. Record it — the write is
in `admin_audit_log` under the admin who made it.

## Backfill after an outage

RevenueCat retries for 24 hours. Beyond that, export the missed events from the RevenueCat
dashboard and re-send them to the webhook with the correct `Authorization` header; the
ledger makes re-sending safe at any volume — every event id is applied at most once, and
anything already superseded is ignored rather than re-applied.

## Prevention

- Alert on non-2xx from `revenuecat-webhook` (Dashboard → Logs → alert on status >= 400).
- Watch for a run of `USER_NOT_FOUND`: that is an app regression, not a backend one.
- Keep `REVENUECAT_ENTITLEMENT_ID` in step with the entitlement id in RevenueCat.
