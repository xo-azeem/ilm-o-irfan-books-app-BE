-- =============================================================================
-- Subscription cancellation: the reader's request, the store's confirmation,
-- and the emails that follow.
-- =============================================================================
-- A membership is billed by the App Store or Google Play, and only the store
-- can stop it renewing: neither Apple nor Google exposes an API that lets a
-- third-party backend cancel a subscription on the reader's behalf. What the
-- backend *can* own is everything around that moment:
--
--   1. the reader's intent — `request_subscription_cancellation()` stamps
--      `entitlements.cancel_requested_at` before the app opens the store's
--      own cancel sheet, so the request is on record even if the reader
--      backs out of the sheet;
--   2. the store's confirmation — RevenueCat's CANCELLATION webhook flips
--      `status` to `cancelled`. Nothing here changes what that means: the
--      canonical rule (`entitlement_has_access`) already keeps a cancelled
--      membership open until `expires_at`, i.e. the period already paid for;
--   3. the mail — a trigger on `entitlements` turns the status transitions
--      into rows in `email_outbox`, and the `email-dispatch` Edge Function
--      sends them. Cancelled, resumed (UNCANCELLATION), ended (EXPIRATION or
--      the minutely sweep), and one reminder when a reader asked to cancel
--      but the store never confirmed — the case that otherwise ends in a
--      surprise charge and a chargeback.
--
-- The outbox is the same shape as `push_outbox`: claim (skip-locked), send,
-- write back, retry with backoff, kicked by pg_net on insert and by a minutely
-- pg_cron tick. Nothing the app can reach writes to it.
-- =============================================================================

-- =============================================================================
-- 1. The reader's request
-- =============================================================================

alter table public.entitlements
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reminder_sent_at timestamptz;

comment on column public.entitlements.cancel_requested_at is
  'When the reader last asked, in the app, to cancel. The store confirms by '
  'webhook (status -> cancelled); until then the membership still renews. '
  'Cleared when the store confirms, when the reader resumes, or when a renewal '
  'lands after the request.';

comment on column public.entitlements.cancel_reminder_sent_at is
  'When the "you started cancelling but the store has not confirmed" email '
  'went out for the current cancel_requested_at. One per request.';

-- SELECT on entitlements is granted per column (20260912120100), so a new
-- column is invisible to readers until it is named here. entitlements-status
-- reads it with the caller's JWT, and the app's table fallback selects `*` —
-- without this grant both fail with 42501, not with a missing field. The
-- reminder stamp stays private: it is the sweep's bookkeeping, not a fact
-- about the reader's membership.
grant select (cancel_requested_at) on table public.entitlements to authenticated;

-- The renewing statuses: a request only makes sense against one of these.
-- 'cancelled' is already done; 'expired' has nothing to cancel.
create or replace function private.entitlement_is_renewing(p_status text)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select p_status in ('active', 'trial', 'grace', 'billing_issue');
$fn$;

-- Stores the reader can cancel from their device. A promotional comp or a
-- Stripe row is not managed by a store sheet, and the app must not send the
-- reader there to look for a subscription that does not exist.
create or replace function private.entitlement_store_managed(p_store text)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select p_store in ('app_store', 'play_store');
$fn$;

-- What the app renders after the tap, and what entitlements-status also
-- carries: the reader's access state plus the two facts the cancel flow
-- needs — which store to open, and whether a request is already pending.
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
  v_store text;
  v_cancel_requested_at timestamptz;
  v_is_admin boolean;
  v_has_access boolean;
begin
  select coalesce(p.role = 'admin', false)
  into v_is_admin
  from public.profiles p
  where p.id = p_user_id;

  v_is_admin := coalesce(v_is_admin, false);

  select e.status, e.expires_at, e.starts_at, e.store, e.cancel_requested_at
  into v_status, v_expires_at, v_starts_at, v_store, v_cancel_requested_at
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
    end,
    -- The cancel flow. `store` says which sheet to open; a pending request
    -- is one the store has not confirmed yet, so the membership still renews.
    'store', v_store,
    'cancelRequestedAt', v_cancel_requested_at,
    'cancelPending',
      v_cancel_requested_at is not null and private.entitlement_is_renewing(v_status)
  );
end;
$fn$;

comment on function public.user_access_state(uuid) is
  'Full subscription access state for one reader, including serverTime for '
  'client clock-skew correction and the cancel-request facts. Service-role only; '
  'readers use my_access_state().';

revoke all on function public.user_access_state(uuid) from public, anon, authenticated;
grant execute on function public.user_access_state(uuid) to service_role;

-- The reader's one move. Records the intent and answers with the state the
-- app should render next; the app then opens the store sheet. Idempotent: a
-- second tap re-stamps the request (and re-arms the reminder), which is what
-- a reader who backed out of the sheet and came back wants.
--
-- Raised codes are the contract with the app (message = code, detail = the
-- sentence), the same convention as request_account_deletion():
--   NO_SUBSCRIPTION      nothing renewing to cancel
--   NOT_STORE_MANAGED    comp / Stripe — not something a store sheet can end
create or replace function public.request_subscription_cancellation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.entitlements%rowtype;
  v_state jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  select * into v_row
  from public.entitlements e
  where e.user_id = v_uid
  for update;

  if not found
     or not public.entitlement_has_access(v_row.status, v_row.expires_at) then
    raise exception 'NO_SUBSCRIPTION'
      using detail = 'There is no active membership on this account to cancel.',
            errcode = 'P0002';
  end if;

  -- Already done: the store has confirmed and the membership is paid through.
  -- Not an error — the app shows the ending state either way.
  if v_row.status = 'cancelled' then
    v_state := public.user_access_state(v_uid);
    return v_state || jsonb_build_object('requested', false, 'alreadyCancelled', true);
  end if;

  if not private.entitlement_store_managed(v_row.store) then
    raise exception 'NOT_STORE_MANAGED'
      using detail = 'This membership is not billed through the App Store or Google Play. Contact support to make changes.',
            errcode = 'P0001';
  end if;

  update public.entitlements
  set cancel_requested_at = timezone('utc', now()),
      cancel_reminder_sent_at = null
  where user_id = v_uid;

  v_state := public.user_access_state(v_uid);
  return v_state || jsonb_build_object('requested', true, 'alreadyCancelled', false);
end;
$fn$;

comment on function public.request_subscription_cancellation() is
  'Reader records the intent to cancel before the app opens the store''s manage-'
  'subscriptions sheet. The store confirms by webhook. Answers user_access_state() '
  'plus requested / alreadyCancelled.';

revoke all on function public.request_subscription_cancellation() from public, anon;
grant execute on function public.request_subscription_cancellation() to authenticated, service_role;

-- The reader changed their mind before finishing in the store. Only the
-- request is withdrawn — a membership the store has already marked cancelled
-- is resumed in the store, not here — so this is a no-op on anything but a
-- pending request, and never an error.
create or replace function public.withdraw_subscription_cancellation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_withdrawn boolean := false;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  update public.entitlements
  set cancel_requested_at = null,
      cancel_reminder_sent_at = null
  where user_id = v_uid
    and cancel_requested_at is not null
    and private.entitlement_is_renewing(status);

  v_withdrawn := found;

  return public.user_access_state(v_uid) || jsonb_build_object('withdrawn', v_withdrawn);
end;
$fn$;

comment on function public.withdraw_subscription_cancellation() is
  'Clears a pending cancel request the store has not confirmed. No-op (withdrawn: false) otherwise.';

revoke all on function public.withdraw_subscription_cancellation() from public, anon;
grant execute on function public.withdraw_subscription_cancellation() to authenticated, service_role;

-- =============================================================================
-- 2. The outbox
-- =============================================================================

create table if not exists public.email_outbox (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  -- Captured at enqueue so a row is self-contained; the claim re-reads the
  -- profile in case the address changed in between.
  to_email text,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  deliver_after timestamptz not null default timezone('utc', now()),
  last_error text,
  -- The provider's own id for the message, for support lookups.
  provider_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  constraint email_outbox_kind_check check (
    kind in (
      'membership_cancelled',
      'membership_resumed',
      'membership_ended',
      'cancellation_unfinished'
    )
  ),
  constraint email_outbox_status_check check (
    status in ('pending', 'processing', 'sent', 'failed', 'skipped')
  )
);

comment on table public.email_outbox is
  'Transactional email queue. Rows are written by triggers and sweeps, claimed '
  'and sent by the email-dispatch Edge Function. No client access.';

create index if not exists email_outbox_due_idx
  on public.email_outbox (deliver_after)
  where status in ('pending', 'processing');

create index if not exists email_outbox_user_kind_idx
  on public.email_outbox (user_id, kind, created_at desc);

drop trigger if exists email_outbox_set_updated_at on public.email_outbox;
create trigger email_outbox_set_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;

-- No policy for anon or authenticated: an email address next to a billing
-- event is not something a device gets to read, and nothing a device sends
-- may become an email.
revoke all on public.email_outbox from public, anon, authenticated;
grant all on public.email_outbox to service_role;

-- Claim due rows for one dispatcher run. A run that died mid-way leaves rows
-- in `processing`; they are taken back after ten minutes. The recipient is
-- re-read from the profile so a changed address wins over the captured one.
create or replace function public.email_outbox_claim(p_limit integer default 50)
returns table (
  id bigint,
  user_id uuid,
  to_email text,
  kind text,
  data jsonb,
  attempts integer
)
language sql
security definer
set search_path = public
as $fn$
  with due as (
    select o.id
    from public.email_outbox o
    where (o.status = 'pending' and o.deliver_after <= timezone('utc', now()))
       or (o.status = 'processing' and o.updated_at < timezone('utc', now()) - interval '10 minutes')
    order by o.deliver_after
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ),
  claimed as (
    update public.email_outbox o
    set status = 'processing',
        attempts = o.attempts + 1
    from due
    where o.id = due.id
    returning o.id, o.user_id, o.to_email, o.kind, o.data, o.attempts
  )
  select
    c.id,
    c.user_id,
    coalesce(nullif(p.email, ''), c.to_email) as to_email,
    c.kind,
    c.data,
    c.attempts
  from claimed c
  left join public.profiles p on p.id = c.user_id;
$fn$;

revoke all on function public.email_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.email_outbox_claim(integer) to service_role;

-- Enqueue one email for one reader. Quiet when there is nobody to write to.
--
-- Deduplicated on (user, kind, expiresAt) inside an hour: a webhook replay or
-- an admin re-saving the same row must not send the same letter twice.
create or replace function private.email_enqueue(
  p_user_id uuid,
  p_kind text,
  p_data jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text;
  v_id bigint;
begin
  select nullif(p.email, '') into v_email
  from public.profiles p
  where p.id = p_user_id;

  if v_email is null then
    return null;
  end if;

  if exists (
    select 1
    from public.email_outbox o
    where o.user_id = p_user_id
      and o.kind = p_kind
      and o.status <> 'failed'
      and o.created_at > timezone('utc', now()) - interval '1 hour'
      and coalesce(o.data ->> 'expiresAt', '') = coalesce(p_data ->> 'expiresAt', '')
  ) then
    return null;
  end if;

  insert into public.email_outbox (user_id, to_email, kind, data)
  values (p_user_id, v_email, p_kind, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function private.email_enqueue(uuid, text, jsonb) from public, anon, authenticated;

-- The facts every membership letter needs.
create or replace function private.membership_email_facts(p_row public.entitlements)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'userId', p_row.user_id,
    'status', p_row.status,
    'expiresAt', p_row.expires_at,
    'store', p_row.store,
    'planName', (select pl.name from public.plans pl where pl.id = p_row.plan_id),
    'fullName', (select pr.full_name from public.profiles pr where pr.id = p_row.user_id)
  );
$fn$;

-- =============================================================================
-- 3. Turning status transitions into mail
-- =============================================================================

-- BEFORE UPDATE: keep the request columns honest.
--
--   * the store confirmed (-> cancelled): the request is answered; the
--     reminder is moot;
--   * the reader resumed (cancelled -> renewing): they changed their mind in
--     the store, so a stale request must not keep showing "pending";
--   * a renewal landed after the request (expires_at moved forward while the
--     status stayed renewing): the store never got the cancellation and the
--     reader has been charged. The request is over, and if the hourly
--     reminder has not gone out yet it goes now — this is exactly the letter
--     that prevents the "I cancelled, why was I billed?" conversation.
create or replace function private.entitlement_cancel_request_maintain()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.cancel_requested_at is null then
    return new;
  end if;

  if new.status = 'cancelled' or new.status = 'expired' then
    new.cancel_requested_at := null;
    new.cancel_reminder_sent_at := null;
    return new;
  end if;

  if old.status = 'cancelled' and private.entitlement_is_renewing(new.status) then
    new.cancel_requested_at := null;
    new.cancel_reminder_sent_at := null;
    return new;
  end if;

  if private.entitlement_is_renewing(new.status)
     and new.expires_at is not null
     and old.expires_at is not null
     and new.expires_at > old.expires_at then
    if new.cancel_reminder_sent_at is null then
      perform private.email_enqueue(
        new.user_id,
        'cancellation_unfinished',
        private.membership_email_facts(new) || jsonb_build_object('renewed', true)
      );
    end if;
    new.cancel_requested_at := null;
    new.cancel_reminder_sent_at := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists entitlements_cancel_request_maintain on public.entitlements;
create trigger entitlements_cancel_request_maintain
before update on public.entitlements
for each row
when (
  old.status is distinct from new.status
  or old.expires_at is distinct from new.expires_at
)
execute function private.entitlement_cancel_request_maintain();

-- AFTER UPDATE: the letters. Only real transitions, never a same-status
-- rewrite — the webhook re-applies a row on retry, and an admin re-saving a
-- form is not news.
--
-- Admins are not skipped here on purpose: the mail describes the *billing*
-- row, and an admin who also pays for a membership is billed like anyone.
create or replace function private.email_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_facts jsonb;
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  v_facts := private.membership_email_facts(new);

  -- The store confirmed the cancellation. Access runs to expires_at.
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.email_enqueue(new.user_id, 'membership_cancelled', v_facts);
    return null;
  end if;

  -- The reader turned auto-renew back on before the period ended.
  if old.status = 'cancelled' and private.entitlement_is_renewing(new.status) then
    perform private.email_enqueue(new.user_id, 'membership_resumed', v_facts);
    return null;
  end if;

  -- Access actually ended. Written by the EXPIRATION webhook or the minutely
  -- sweep; either way the reader has just lost the library, and a letter
  -- with a way back is the least the product owes them. A row that was
  -- already denied (old status expired) is not a transition worth a letter.
  if new.status = 'expired' and old.status <> 'expired' then
    perform private.email_enqueue(
      new.user_id,
      'membership_ended',
      v_facts || jsonb_build_object('wasCancelled', old.status = 'cancelled')
    );
    return null;
  end if;

  return null;
end;
$fn$;

drop trigger if exists entitlements_email_membership_change on public.entitlements;
create trigger entitlements_email_membership_change
after update on public.entitlements
for each row
when (old.status is distinct from new.status)
execute function private.email_membership_change();

-- =============================================================================
-- 4. The reminder sweep
-- =============================================================================

-- A reader who tapped Cancel, was sent to the store sheet, and never finished
-- still has a renewing membership. One reminder, an hour later, once per
-- request. The BEFORE UPDATE trigger above covers the case where a renewal
-- arrives before this fires.
create or replace function public.subscription_cancellation_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.entitlements%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select e.*
    from public.entitlements e
    where e.cancel_requested_at is not null
      and e.cancel_reminder_sent_at is null
      and private.entitlement_is_renewing(e.status)
      and e.cancel_requested_at <= timezone('utc', now()) - interval '1 hour'
    order by e.cancel_requested_at
    limit 200
    for update skip locked
  loop
    perform private.email_enqueue(
      v_row.user_id,
      'cancellation_unfinished',
      private.membership_email_facts(v_row) || jsonb_build_object('renewed', false)
    );

    update public.entitlements
    set cancel_reminder_sent_at = timezone('utc', now())
    where user_id = v_row.user_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

comment on function public.subscription_cancellation_reminders() is
  'Every 10 minutes: emails readers who asked to cancel over an hour ago and '
  'whose store has not confirmed. One reminder per request.';

revoke all on function public.subscription_cancellation_reminders() from public, anon, authenticated;
grant execute on function public.subscription_cancellation_reminders() to service_role;

-- =============================================================================
-- 5. Kicking the dispatcher
-- =============================================================================
-- Same shape as push_dispatch_kick: config in private.runtime_config, an
-- asynchronous pg_net call, a no-op with a notice when unconfigured. The Edge
-- Function checks the secret before touching anything.

create or replace function private.email_dispatch_kick()
returns boolean
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.email_outbox
    where status = 'pending' and deliver_after <= timezone('utc', now())
  ) then
    return false;
  end if;

  select value into v_url from private.runtime_config where key = 'supabase_url';
  select value into v_secret from private.runtime_config where key = 'email_dispatch_secret';

  if v_url is null or v_secret is null then
    raise notice 'email_dispatch_kick: runtime_config missing supabase_url/email_dispatch_secret; nothing sent';
    return false;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/email-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', v_secret,
      'User-Agent', 'ilm-o-irfan-email-kick/1'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );

  return true;
end;
$fn$;

comment on function private.email_dispatch_kick() is
  'Fires the email-dispatch Edge Function when the outbox has due rows. No-op until private.runtime_config has supabase_url and email_dispatch_secret.';

revoke all on function private.email_dispatch_kick() from public, anon, authenticated;
grant execute on function private.email_dispatch_kick() to service_role;

create or replace function private.email_outbox_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform private.email_dispatch_kick();
  return null;
end;
$fn$;

drop trigger if exists email_outbox_kick on public.email_outbox;
create trigger email_outbox_kick
after insert on public.email_outbox
for each statement execute function private.email_outbox_after_insert();

-- Sent rows are a log for "did that go out?", not a queue. A month covers a
-- billing cycle's worth of support questions.
create or replace function public.prune_email_outbox(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  with gone as (
    delete from public.email_outbox
    where status in ('sent', 'failed', 'skipped')
      and processed_at < timezone('utc', now()) - make_interval(days => greatest(1, p_keep_days))
    returning 1
  )
  select count(*) into v_count from gone;

  return coalesce(v_count, 0);
end;
$fn$;

revoke all on function public.prune_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.prune_email_outbox(integer) to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('email-dispatch-tick')
    where exists (select 1 from cron.job where jobname = 'email-dispatch-tick');
    perform cron.schedule(
      'email-dispatch-tick',
      '* * * * *',
      $cron$select private.email_dispatch_kick()$cron$
    );

    perform cron.unschedule('subscription-cancellation-reminders')
    where exists (select 1 from cron.job where jobname = 'subscription-cancellation-reminders');
    perform cron.schedule(
      'subscription-cancellation-reminders',
      '*/10 * * * *',
      $cron$select public.subscription_cancellation_reminders()$cron$
    );

    perform cron.unschedule('prune-email-outbox')
    where exists (select 1 from cron.job where jobname = 'prune-email-outbox');
    perform cron.schedule(
      'prune-email-outbox',
      '47 3 * * *',
      $cron$select public.prune_email_outbox()$cron$
    );
  else
    raise warning 'pg_cron unavailable: email-dispatch-tick and subscription-cancellation-reminders NOT scheduled. Mail still goes out on insert; the unfinished-cancellation reminder will not.';
  end if;
exception
  when others then
    raise warning 'could not schedule email jobs (%)', sqlerrm;
end;
$do$;

-- =============================================================================
-- 6. Notes
-- =============================================================================
-- * `apply_revenuecat_entitlement()` is untouched: it does not name the new
--   columns, so an INSERT ... ON CONFLICT leaves cancel_requested_at alone
--   and the BEFORE UPDATE trigger is what maintains it.
-- * `access_events` copies named keys out of user_access_state(); the new keys
--   are simply not copied, so the change feed's shape is unchanged.
-- * The Edge secrets are EMAIL_DISPATCH_SECRET (must equal
--   runtime_config.email_dispatch_secret), RESEND_API_KEY and EMAIL_FROM.
--   Until they are set, rows wait in `pending` — nothing is lost.
