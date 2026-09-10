-- =============================================================================
-- The live subscription channel, take two
--
-- 20260910120000 pushed entitlement changes over Realtime Broadcast
-- (realtime.send → a private per-reader topic). That is the right shape and it
-- works locally. It does NOT work on the hosted project, and the failure is
-- silent, which is the worst part:
--
--   realtime.messages is RANGE partitioned on inserted_at, the hosted project
--   has ZERO partitions, and realtime.send() wraps its INSERT in
--   `exception when others then raise warning`. So every broadcast is dropped
--   with a warning nobody reads, the entitlement write succeeds, and the device
--   is simply never told. Verified on rwnmckrepvycydmtgvcq:
--     WARNING: WarnSendingBroadcastMessage: no partition of relation
--              "messages" found for row
--
-- We cannot fix that ourselves. Partitions must be created in the `realtime`
-- schema, and the `postgres` role there is not a superuser, not a member of
-- supabase_realtime_admin, and holds no CREATE on the schema. Partition
-- maintenance belongs to Supabase's own Realtime service.
--
-- So the delivered channel becomes Postgres Changes on a table we do own.
--
-- Why a new narrow table rather than publishing public.entitlements: that row
-- carries `raw_event` - the entire RevenueCat webhook payload - plus store and
-- billing ids. Postgres Changes ships the whole row to the device. None of that
-- belongs on a phone just to say "your membership ended". access_events carries
-- the computed answer and nothing else, which is exactly what the broadcast
-- payload carried.
--
-- The broadcast call stays in the trigger. It costs nothing, it is already
-- exception-guarded, and it starts working by itself if Supabase ever
-- provisions partitions on this project. Clients subscribe to access_events.
-- Both carry the same idempotent state, so a client that ends up hearing both
-- applies the same answer twice - a no-op, not a bug.
-- =============================================================================

-- =============================================================================
-- The channel table
-- =============================================================================

create table if not exists public.access_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- The same fields the broadcast payload carried, so one client reducer
  -- handles this, the broadcast, and the entitlements-status body.
  can_access_premium boolean not null,
  is_active boolean not null,
  is_admin boolean not null default false,
  status text,
  expires_at timestamptz,
  reason text not null,
  seconds_remaining bigint,
  server_time timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.access_events is
  'Append-only notification of a change in one reader''s access. Exists because '
  'Realtime Broadcast is undeliverable on the hosted project (realtime.messages '
  'has no partitions and we cannot create them). Clients subscribe with Postgres '
  'Changes filtered to their own user_id. Never contains billing internals.';

-- The read path is always "this reader, newest first".
create index if not exists access_events_user_created_idx
  on public.access_events (user_id, created_at desc);

alter table public.access_events enable row level security;

-- A reader sees their own events and nothing else. This is also what the
-- Realtime authorisation check runs, so it decides who may subscribe.
drop policy if exists "access_events_select_own" on public.access_events;

create policy "access_events_select_own"
  on public.access_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policy: only the trigger writes here, and it runs as
-- definer. A device cannot manufacture itself an unlock.
revoke all on public.access_events from anon, authenticated;
grant select on public.access_events to authenticated;
grant all on public.access_events to service_role;

-- =============================================================================
-- Publish it
-- =============================================================================

-- Postgres Changes only delivers rows from tables in this publication.
-- Adding a table twice is an error, so this is guarded.
do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'access_events'
  ) then
    alter publication supabase_realtime add table public.access_events;
  end if;
exception
  when others then
    raise warning 'could not add access_events to supabase_realtime (%): live '
      'push will not work until this is fixed', sqlerrm;
end;
$do$;

-- =============================================================================
-- Write to it
-- =============================================================================

create or replace function private.broadcast_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
  v_state jsonb;
begin
  v_state := public.user_access_state(v_user_id);

  -- The delivered channel. Not exception-guarded on purpose: if the device
  -- cannot be told, that is worth knowing about, and unlike the broadcast this
  -- is a plain insert into our own table with nothing exotic to fail.
  insert into public.access_events (
    user_id, can_access_premium, is_active, is_admin,
    status, expires_at, reason, seconds_remaining, server_time
  )
  values (
    v_user_id,
    coalesce((v_state->>'canAccessPremium')::boolean, false),
    coalesce((v_state->>'isActive')::boolean, false),
    coalesce((v_state->>'isAdmin')::boolean, false),
    v_state->>'status',
    (v_state->>'expiresAt')::timestamptz,
    coalesce(v_state->>'reason', 'none'),
    (v_state->>'secondsRemaining')::bigint,
    coalesce((v_state->>'serverTime')::timestamptz, timezone('utc', now()))
  );

  -- Best effort, and currently a no-op on the hosted project. Kept so this
  -- starts working the day realtime.messages gains partitions, without another
  -- migration. realtime.send() swallows its own errors; the extra guard is for
  -- the case where the function itself is missing.
  begin
    perform realtime.send(
      v_state,
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

-- =============================================================================
-- Keep it small
-- =============================================================================

-- Append-only tables grow forever. Nothing reads an access event older than the
-- session that missed it, so a week is generous.
create or replace function public.prune_access_events(p_keep_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  with gone as (
    delete from public.access_events
    where created_at < timezone('utc', now()) - make_interval(days => greatest(1, p_keep_days))
    returning 1
  )
  select count(*) into v_count from gone;

  return coalesce(v_count, 0);
end;
$fn$;

revoke all on function public.prune_access_events(integer) from public, anon, authenticated;
grant execute on function public.prune_access_events(integer) to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune-access-events')
    where exists (select 1 from cron.job where jobname = 'prune-access-events');

    perform cron.schedule(
      'prune-access-events',
      '17 3 * * *',
      $cron$select public.prune_access_events(7)$cron$
    );
  end if;
exception
  when others then
    raise warning 'could not schedule prune-access-events (%)', sqlerrm;
end;
$do$;
