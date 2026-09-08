# Runbook: premium books opening for free

**Severity:** high — this is revenue leaving.

## Symptom

A user with no subscription gets a signed URL for a book, instead of
`403 PREMIUM_REQUIRED`.

## What cannot be the cause (any more)

**`is_premium` is not it.** The catalogue is subscription-only and `get-signed-pdf` does
not read that column. An unflagged book is gated exactly like a flagged one, so "the title
was never marked premium" — historically the most common answer here — can no longer
produce this symptom. If it looks like the cause, you have found a genuine regression in
the endpoint; go to step 3.

`get-signed-pdf` also no longer reads `ALLOW_PDF_WITHOUT_ENTITLEMENT` or
`app_settings.allow_pdf_without_entitlement`. The env flag was removed from the code and
the column has been dropped from the schema — both precisely because a global switch could
open the paywall from a place nobody reviews. If someone tells you to "check the env flag",
that is stale advice.

Access is granted on exactly two conditions and no others:

1. the caller is an admin, or
2. the book is published and the caller has an active entitlement.

## Triage, in order

### 1. Is the caller an admin?

```sql
select id, email, role from public.profiles where id = '<user-id>';
```

Admins are served every PDF, drafts included, with no subscription — that is deliberate
and the app relies on it. An admin account handed to a tester or shared internally is now
the most likely explanation for an unexpected 200. Check the JWT too:
`app_metadata.app_role` grants admin independently of the `profiles` row.

If the account should not be an admin:

```
POST /functions/v1/admin-set-user-role  { "userId": "<user-id>", "role": "user" }
```

The JWT keeps the old `app_role` claim until the token is reissued, so **the user must sign
out and back in** before the demotion takes effect in the claim path. The `profiles.role`
fallback in `is_admin()` closes the window in the other direction (promotions) but not this
one — a stale token still carries `app_role: admin` until it expires (1 hour by default).

### 2. Does the user hold an entitlement?

```sql
select user_id, status, expires_at, store, last_revenuecat_event_at
from public.entitlements
where user_id = '<user-id>';
```

`status = 'active'` with `expires_at` null or in the future is a valid grant. A row with
`store = 'promotional'` is a manual comp — check `admin_audit_log` for who granted it:

```
GET /functions/v1/admin-audit-log?entityId=<user-id>
```

### 3. Is a RevenueCat event granting more than it should?

```sql
select id, event_type, event_timestamp, created_at
from public.revenuecat_events
where user_id = '<user-id>'
order by event_timestamp desc
limit 20;
```

Check `REVENUECAT_ENTITLEMENT_ID` matches the entitlement configured in RevenueCat. If the
env value names an entitlement that does not exist, every event looks like an
account-wide event and grants premium. See [webhook-down.md](./webhook-down.md).

## Containment while you investigate

Revoke one user:

```
POST /functions/v1/admin-set-entitlement
{ "userId": "<user-id>", "status": "expired" }
```

There is no global kill switch, and adding one would recreate the class of bug this design
removed. If the leak is systemic, unpublish the affected titles
(`admin-bulk-update-books { ids, is_published: false }`) — that removes them from the
catalog for everyone, which is visible and reversible, rather than silently changing who
may read them.

## Afterwards

- Confirm the `PREMIUM_REQUIRED` path in `scripts/e2e-endpoints.sh` still passes.
- If the cause was data, look for other rows with the same shape before closing.
