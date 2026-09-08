-- =============================================================================
-- Subscription lifecycle: one access rule, an expiry sweep, and a live channel
--
-- The catalogue is subscription-only (20260909140000). This migration answers
-- the next question: what happens the moment a subscription ends while someone
-- is holding three books open.
--
-- Three problems, three parts.
--
-- PART A - there was no single definition of "has access".
--   get-signed-pdf and entitlements-status both tested `status = 'active'`.
--   But the webhook writes 'trial', 'cancelled' and 'billing_issue' too, and
--   its own comment says a reader who cancels on day 2 keeps the month. The
--   gate disagreed: it locked them out immediately. So a canonical rule lives
--   here now, in SQL, and both endpoints call it rather than re-implementing
--   it. Access is "not expired, and not past expires_at" - which makes
--   `expires_at` the single thing that ends a subscription.
--
-- PART B - expiry is not an event.
--   Nothing writes to the database when now() crosses expires_at. A row that
--   lapsed a week ago looks byte-for-byte identical to one that lapsed a
--   second ago, so there is nothing for Realtime to notice and nothing to
--   push. A minutely pg_cron sweep flips lapsed rows to 'expired', which turns
--   the passage of time into an actual UPDATE that can be broadcast.
--
--   This bounds the server-side lock at ~60s, not 0s. Exactness is the
--   client's job: it already knows expires_at, so it can lock on its own timer
--   at the precise instant, offline, with no socket. The channel below is what
--   corrects that timer when the date itself moves - a renewal, a refund, an
--   admin revoke. Do not treat the socket as the lock; a reader who turns off
--   wifi one second before expiry would keep reading forever.
--
-- PART C - nothing could be delivered live.
--   realtime.messages has RLS enabled and no policies at all, so private
--   broadcasts were unreachable by every client. A per-user topic and a policy
--   for it are added here.
--
--   Broadcast-from-trigger is used rather than postgres_changes on purpose:
--   postgres_changes re-evaluates RLS for every subscriber on every change,
--   which is the wrong shape for a table every signed-in reader watches.
-- =============================================================================

-- =============================================================================
-- PART A - the canonical access rule
-- =============================================================================

-- The whole rule, in one place.
--
-- 'expired' is the only status that denies on its own. Everything else -
-- 'active', 'trial', 'cancelled' (will not renew, but paid through),
-- 'grace' and 'billing_issue' (card failing, still inside the paid period) -
-- grants access right up to expires_at and not one second past it.
--
-- A null expires_at means no end date: a lifetime or promotional comp. Those
-- are never swept by PART B. A null status means the reader has no
-- entitlement row at all and has never subscribed.
create or replace function public.entitlement_has_access(
  p_status text,
  p_expires_at timestamptz,
  p_now timestamptz default timezone('utc', now())
)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select p_status is not null
     and p_status <> 'expired'
     and (p_expires_at is null or p_expires_at > p_now);
$fn$;

comment on function public.entitlement_has_access(text, timestamptz, timestamptz) is
  'Canonical subscription access rule. Every gate must call this rather than '
  'testing status directly - see get-signed-pdf and entitlements-status.';

-- Why access was granted or denied. The app shows a different screen for
-- "your card failed" than for "you never subscribed", so the reason travels
-- with the answer instead of being guessed from status + expires_at.
create or replace function public.entitlement_access_reason(
  p_status text,
  p_expires_at timestamptz,
  p_is_admin boolean,
  p_now timestamptz default timezone('utc', now())
)
returns text
language sql
immutable
parallel safe
as $fn$
  select case
    when p_is_admin then 'admin'
    when p_status is null then 'none'
    when not public.entitlement_has_access(p_status, p_expires_at, p_now) then
      case when p_status = 'expired' then 'expired' else 'lapsed' end
    when p_status = 'trial' then 'trial'
    when p_status = 'cancelled' then 'cancelled_paid_through'
    when p_status = 'grace' then 'grace'
    when p_status = 'billing_issue' then 'billing_issue_paid_through'
    else 'active'
  end;
$fn$;

-- The complete answer for one reader, as the app needs it.
--
-- serverTime is not decoration: the client runs the countdown that actually
-- locks the screen, so it needs to know how far its own clock is off. A device
-- whose clock is dragged backwards must not earn extra reading time.
create or replace function public.user_access_state(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_now timestamptz := timezone('utc', now());
  v_status text;
  v_expires_at timestamptz;
  v_starts_at timestamptz;
  v_is_admin boolean;
  v_has_access boolean;
begin
  select coalesce(p.role = 'admin', false)
  into v_is_admin
  from public.profiles p
  where p.id = p_user_id;

  v_is_admin := coalesce(v_is_admin, false);

  select e.status, e.expires_at, e.starts_at
  into v_status, v_expires_at, v_starts_at
  from public.entitlements e
  where e.user_id = p_user_id;

  v_has_access := public.entitlement_has_access(v_status, v_expires_at, v_now);

  return jsonb_build_object(
    'userId', p_user_id,
    'status', v_status,
    'startsAt', v_starts_at,
    'expiresAt', v_expires_at,
    -- isActive is the subscription alone. canAccessPremium is what the app
    -- gates on, because an admin holds no subscription and is still served.
    'isActive', v_has_access,
    'isAdmin', v_is_admin,
    'canAccessPremium', v_has_access or v_is_admin,
    'reason', public.entitlement_access_reason(v_status, v_expires_at, v_is_admin, v_now),
    'serverTime', v_now,
    -- Null when there is no end date at all (lifetime, comp, or admin).
    -- Never negative: a lapsed subscription reads 0, not "-4 days".
    'secondsRemaining', case
      when v_expires_at is null then null
      else greatest(0, floor(extract(epoch from (v_expires_at - v_now))))::bigint
    end
  );
end;
$fn$;

comment on function public.user_access_state(uuid) is
  'Full subscription access state for one reader, including serverTime for '
  'client clock-skew correction. Service-role only; readers use my_access_state().';

revoke all on function public.user_access_state(uuid) from public, anon, authenticated;
grant execute on function public.user_access_state(uuid) to service_role;

-- The same answer, for the caller about themselves. This is what a client
-- polls when its socket is down, so it is reachable with a user JWT and
-- cannot be pointed at anybody else.
create or replace function public.my_access_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when auth.uid() is null then null
    else public.user_access_state(auth.uid())
  end;
$fn$;

revoke all on function public.my_access_state() from public, anon;
grant execute on function public.my_access_state() to authenticated, service_role;

-- =============================================================================
-- PART B - turning the passage of time into an event
-- =============================================================================

-- Finds lapsed rows without reading the table. Partial, because the rows that
-- matter are the handful that have not been swept yet - the index does not
-- carry every expired subscription the product has ever sold.
create index if not exists entitlements_expiry_sweep_idx
  on public.entitlements (expires_at)
  where status <> 'expired';

-- Flips lapsed subscriptions to 'expired'. Each row updated fires the
-- broadcast trigger in PART C, so this is what pushes the lock out to devices.
--
-- Deliberately does NOT touch last_revenuecat_event_at. That column is the
-- ordering guard in apply_revenuecat_entitlement(); bumping it here would make
-- the sweep look like a newer event than a renewal still in flight, and the
-- renewal would be discarded as stale. A reader would pay and stay locked out.
--
-- Idempotent: the second run in the same minute updates nothing.
create or replace function public.expire_lapsed_entitlements()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  with lapsed as (
    update public.entitlements
    set status = 'expired',
        updated_at = timezone('utc', now())
    where status <> 'expired'
      and expires_at is not null
      and expires_at <= timezone('utc', now())
    returning user_id
  )
  select count(*) into v_count from lapsed;

  return coalesce(v_count, 0);
end;
$fn$;

comment on function public.expire_lapsed_entitlements() is
  'Minutely sweep: flips lapsed entitlements to expired so the passage of time '
  'becomes an UPDATE that Realtime can broadcast. Bounds server-side lock at ~60s; '
  'the client timer is what makes it exact.';

revoke all on function public.expire_lapsed_entitlements() from public, anon, authenticated;
grant execute on function public.expire_lapsed_entitlements() to service_role;

-- pg_cron is available on Supabase but not preloaded in every local stack, so
-- a missing extension degrades to a warning rather than failing the migration.
-- Production MUST have the job: verify with the query in
-- docs/runbooks/subscription-expiry.md after deploying. Without it, expiry is
-- enforced on every request and on the client timer, but nothing is pushed.
do $do$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise warning
      'pg_cron unavailable (%): expiry sweep NOT scheduled. Server-side gates still '
      'deny access; only the live push is missing.', sqlerrm;
end;
$do$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Re-running the migration must not stack duplicate jobs.
    perform cron.unschedule('expire-lapsed-entitlements')
    where exists (
      select 1 from cron.job where jobname = 'expire-lapsed-entitlements'
    );

    perform cron.schedule(
      'expire-lapsed-entitlements',
      '* * * * *',
      $cron$select public.expire_lapsed_entitlements()$cron$
    );
  end if;
exception
  when others then
    raise warning 'could not schedule expire-lapsed-entitlements (%)', sqlerrm;
end;
$do$;

-- =============================================================================
-- PART C - the live channel
-- =============================================================================

-- One private topic per reader: entitlement:<user_id>.
--
-- Sends the computed state rather than the raw row diff, so the client never
-- re-implements the access rule - it reads canAccessPremium and obeys. A row
-- diff would also leak store and raw_event to the device for no reason.
create or replace function private.broadcast_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
begin
  -- A Realtime hiccup must never roll back the entitlement write itself. The
  -- database is the authority; the socket is a courtesy, and the client
  -- re-checks on foreground regardless.
  begin
    perform realtime.send(
      public.user_access_state(v_user_id),
      'entitlement_changed',
      'entitlement:' || v_user_id::text,
      true
    );
  exception
    when others then
      raise warning 'entitlement broadcast failed for % (%)', v_user_id, sqlerrm;
  end;

  return null;
end;
$fn$;

drop trigger if exists entitlements_broadcast_change on public.entitlements;
drop trigger if exists entitlements_broadcast_write on public.entitlements;
drop trigger if exists entitlements_broadcast_update on public.entitlements;

-- Split by operation because a trigger WHEN clause cannot read TG_OP: the
-- filter below only makes sense for UPDATE, and insert/delete always matter.
create trigger entitlements_broadcast_write
after insert or delete on public.entitlements
for each row
execute function private.broadcast_entitlement_change();

-- Only when something the app acts on actually moved. updated_at bumps and
-- raw_event rewrites are not worth a push to every device the reader owns.
create trigger entitlements_broadcast_update
after update on public.entitlements
for each row
when (
  old.status is distinct from new.status
  or old.expires_at is distinct from new.expires_at
  or old.plan_id is distinct from new.plan_id
)
execute function private.broadcast_entitlement_change();

-- realtime.messages ships with RLS on and no policies, so until now every
-- private broadcast was undeliverable. A reader may join exactly one topic:
-- their own. realtime.topic() is the topic being authorised.
drop policy if exists "entitlement_topic_select_own" on realtime.messages;

create policy "entitlement_topic_select_own"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'entitlement:' || auth.uid()::text
    and extension = 'broadcast'
  );

-- Read-only channel: the server is the only thing that may say a subscription
-- changed. No INSERT policy is granted, so a device cannot broadcast itself an
-- unlock and cannot send anything to another reader's topic.
