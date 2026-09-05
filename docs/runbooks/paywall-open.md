# Runbook: premium books opening for free

**Severity:** high — this is revenue leaving.

## Symptom

A user with no subscription gets a signed URL for a book where `is_premium = true`, instead
of `403 PREMIUM_REQUIRED`.

## What cannot be the cause (any more)

`get-signed-pdf` no longer reads `ALLOW_PDF_WITHOUT_ENTITLEMENT` or
`app_settings.allow_pdf_without_entitlement`. Both were removed precisely because a global
switch could open the paywall from a place nobody reviews. If someone tells you to "check
the env flag", that is stale advice — the flag does nothing.

Access is granted on exactly three conditions and no others:

1. the caller is an admin,
2. the book is published and `is_premium = false`,
3. the book is premium and the caller has an active entitlement.

## Triage, in order

### 1. Is the book actually premium?

```sql
select id, title, is_premium, is_published from public.books where id = '<book-id>';
```

The most common answer is that the title was never flagged premium. Fix the data:

```
PATCH /functions/v1/admin-book-update  { "id": "<book-id>", "is_premium": true }
```

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

### 3. Is the user an admin?

```sql
select id, email, role from public.profiles where id = '<user-id>';
```

Admins read every PDF including drafts, by design. If the account should not be an admin:

```
POST /functions/v1/admin-set-user-role  { "userId": "<user-id>", "role": "user" }
```

The JWT keeps the old `app_role` claim until the token is reissued, so **the user must sign
out and back in** before the demotion takes effect in the claim path. The `profiles.role`
fallback in `is_admin()` closes the window in the other direction (promotions) but not this
one — a stale token still carries `app_role: admin` until it expires (1 hour by default).

### 4. Is a RevenueCat event granting more than it should?

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
