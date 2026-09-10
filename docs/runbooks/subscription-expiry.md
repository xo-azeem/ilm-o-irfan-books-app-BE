# Runbook: subscriptions not locking (or locking when they shouldn't)

**Severity:** high both ways — one direction is revenue leaving, the other is a paying
reader staring at a paywall.

## How expiry actually works

Three layers. They fail independently, and knowing which one broke is most of the triage.

| Layer | What it does | If it breaks |
| --- | --- | --- |
| **The gate** (`entitlement_has_access`) | Every `get-signed-pdf` re-checks. Denies the instant `now()` passes `expires_at`. | Paid content leaks. Critical. |
| **The sweep** (`expire_lapsed_entitlements`, pg_cron, minutely) | Flips lapsed rows to `expired` so the passage of time becomes an UPDATE worth broadcasting. | Nothing is *pushed*. Access is still refused on every request; readers see the lock on their own timer or on next foreground. Degraded, not broken. |
| **The client timer** | The app counts down to `expires_at` and locks itself, offline, to the second. | A reader keeps the book on screen until they next hit the network. The next `get-signed-pdf` still refuses. |

**The socket is not the lock.** If it were, airplane mode one second before expiry would
buy unlimited reading. The client timer is the exact mechanism; the broadcast exists to
correct that timer when the *date itself* moves — renewal, refund, admin revoke.

## Symptom: a lapsed reader can still open books

### 1. Is the gate itself right?

```sql
select public.entitlement_has_access(status, expires_at), status, expires_at
from public.entitlements where user_id = '<user-id>';
```

`false` here means the backend is refusing and the problem is client-side caching — the app
is serving a file it already downloaded. That is the app's lock to enforce; the backend
cannot recall a file that is already on the device.

`true` when you expect `false` means `expires_at` is in the future. Check whether a renewal
actually arrived (`revenuecat_events`), or whether someone granted a comp.

### 2. Is the caller an admin?

Admins are served everything, forever, with no subscription. See
[paywall-open.md](./paywall-open.md) — same first question, same answer.

### 3. Is `expires_at` null?

A null `expires_at` is a lifetime or promotional grant. It is **never** swept and never
expires. If that was not intended:

```sql
update public.entitlements set expires_at = now() where user_id = '<user-id>';
```

The sweep picks it up within a minute and pushes the lock.

## Symptom: a paying reader is locked out

### 1. What does the rule say, and why?

```sql
select public.user_access_state('<user-id>');
```

`reason` is the answer. `cancelled_paid_through`, `trial`, `grace` and
`billing_issue_paid_through` all still grant access — if the reader is locked out while
showing one of those, the gate has regressed and is no longer calling the shared rule.

`lapsed` means `expires_at` passed. `expired` means something explicitly set that status —
a refund, a chargeback, or the sweep.

### 2. Did the sweep expire someone whose renewal was in flight?

The narrow race: a subscription lapses at T, the sweep locks at T+30s, the RENEWAL webhook
lands at T+45s and unlocks. The reader sees a paywall flash.

The sweep deliberately does **not** touch `last_revenuecat_event_at`, so a late renewal is
never discarded as stale. Confirm it applied:

```sql
select status, expires_at, last_revenuecat_event_at
from public.entitlements where user_id = '<user-id>';
```

If `status = 'expired'` but a RENEWAL event exists with a *later* timestamp, the ordering
guard has a bug — that is a real defect, not a race.

## Is the cron job actually running?

This is the single most likely thing to be quietly missing, because the migration downgrades
a missing `pg_cron` to a warning rather than failing.

```sql
select jobname, schedule, active from cron.job where jobname = 'expire-lapsed-entitlements';
```

Expect one row, `* * * * *`, `active = t`. If there is no row:

```sql
create extension if not exists pg_cron;
select cron.schedule(
  'expire-lapsed-entitlements', '* * * * *',
  $$select public.expire_lapsed_entitlements()$$
);
```

Recent runs and failures. `cron.job_run_details` keys on `jobid`, **not** `jobname` — it
has no such column, so join `cron.job`:

```sql
select d.start_time, d.status, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'expire-lapsed-entitlements'
order by d.start_time desc limit 20;
```

`return_message` reads `1 row` when it locked one subscription, `0 rows` when there was
nothing to do — which is the normal steady state.

Run it by hand — safe, idempotent, returns the number of rows it locked:

```sql
select public.expire_lapsed_entitlements();
```

## Is the live channel working?

Delivery is **Postgres Changes on `public.access_events`**, not Realtime Broadcast. See
"Why not Broadcast" below before trying to fix it the other way.

```sql
-- The table must be published, or nothing is delivered to anyone.
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'access_events';

-- And readable, or the subscription is authorised away to nothing.
select policyname from pg_policies
where schemaname = 'public' and tablename = 'access_events';
```

Expect one publication row and `access_events_select_own`. Watch events land:

```sql
select user_id, can_access_premium, reason, created_at
from public.access_events order by id desc limit 10;
```

If entitlements are changing but no rows appear here, the trigger is the problem:

```sql
select tgname from pg_trigger
where tgrelid = 'public.entitlements'::regclass and not tgisinternal;
```

Expect `entitlements_broadcast_write` and `entitlements_broadcast_update`.

### Why not Broadcast

The original design used `realtime.send()` to a private per-reader topic. It is the
better-scaling shape and the call is still in the trigger, but it is **undeliverable on
the hosted project** and fails silently:

- `realtime.messages` is RANGE partitioned on `inserted_at`.
- The hosted project has **zero partitions**.
- `realtime.send()` wraps its INSERT in `exception when others then raise warning`.

So the insert fails with `WarnSendingBroadcastMessage: no partition of relation
"messages" found for row`, the entitlement write still commits, and the device is never
told. Nothing surfaces as an error.

We cannot create the partitions: the `postgres` role is not a superuser, not a member of
`supabase_realtime_admin`, and holds no `CREATE` on the `realtime` schema. That belongs to
Supabase's Realtime service.

If partitions ever appear on this project, the broadcast starts working on its own with no
migration. Check with:

```sql
select c.relname from pg_class c
join pg_inherits i on i.inhrelid = c.oid
where i.inhparent = 'realtime.messages'::regclass;
```

## Containment

Revoke one reader immediately (pushes the lock within seconds):

```sql
update public.entitlements set status = 'expired' where user_id = '<user-id>';
```

Restore one reader:

```sql
update public.entitlements
set status = 'active', expires_at = now() + interval '30 days'
where user_id = '<user-id>';
```

Both fire the broadcast. Neither touches `last_revenuecat_event_at`, so the next real
RevenueCat event still wins.
