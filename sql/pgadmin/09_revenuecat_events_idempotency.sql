-- pgAdmin twin of 20260831140000_revenuecat_events_idempotency.sql
-- Prefer supabase/migrations via `db push` for staging/production.

create table if not exists public.revenuecat_events (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null,
  event_timestamp timestamptz not null,
  processed_at timestamptz not null default timezone('utc', now()),
  raw_event jsonb not null default '{}'::jsonb
);

create index if not exists revenuecat_events_user_id_idx
  on public.revenuecat_events (user_id);

create index if not exists revenuecat_events_event_timestamp_idx
  on public.revenuecat_events (event_timestamp desc);

alter table public.revenuecat_events enable row level security;

revoke all on table public.revenuecat_events from anon, authenticated;
grant all on table public.revenuecat_events to service_role;

alter table public.entitlements
  add column if not exists last_revenuecat_event_id uuid,
  add column if not exists last_revenuecat_event_at timestamptz;

create index if not exists entitlements_last_rc_event_at_idx
  on public.entitlements (last_revenuecat_event_at desc nulls last);

create or replace function public.apply_revenuecat_entitlement(
  p_user_id uuid,
  p_plan_id uuid,
  p_status text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_store text,
  p_revenuecat_entitlement_id text,
  p_raw_event jsonb,
  p_event_id uuid,
  p_event_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_status is null or p_status not in (
    'active', 'expired', 'cancelled', 'grace', 'billing_issue', 'trial'
  ) then
    raise exception 'invalid entitlement status: %', p_status;
  end if;

  if p_store is not null and p_store not in (
    'app_store', 'play_store', 'stripe', 'promotional', 'unknown'
  ) then
    raise exception 'invalid store: %', p_store;
  end if;

  insert into public.entitlements as e (
    user_id,
    plan_id,
    status,
    starts_at,
    expires_at,
    revenuecat_app_user_id,
    revenuecat_entitlement_id,
    store,
    raw_event,
    last_revenuecat_event_id,
    last_revenuecat_event_at,
    updated_at
  )
  values (
    p_user_id,
    p_plan_id,
    p_status,
    p_starts_at,
    p_expires_at,
    p_user_id::text,
    p_revenuecat_entitlement_id,
    p_store,
    coalesce(p_raw_event, '{}'::jsonb),
    p_event_id,
    p_event_at,
    timezone('utc', now())
  )
  on conflict (user_id) do update
  set
    plan_id = excluded.plan_id,
    status = excluded.status,
    starts_at = excluded.starts_at,
    expires_at = excluded.expires_at,
    revenuecat_app_user_id = excluded.revenuecat_app_user_id,
    revenuecat_entitlement_id = excluded.revenuecat_entitlement_id,
    store = excluded.store,
    raw_event = excluded.raw_event,
    last_revenuecat_event_id = excluded.last_revenuecat_event_id,
    last_revenuecat_event_at = excluded.last_revenuecat_event_at,
    updated_at = timezone('utc', now())
  where e.last_revenuecat_event_at is null
     or e.last_revenuecat_event_at <= excluded.last_revenuecat_event_at
  returning e.status into v_status;

  if v_status is null then
    return jsonb_build_object('applied', false, 'reason', 'stale');
  end if;

  return jsonb_build_object('applied', true, 'status', v_status);
end;
$$;

revoke all on function public.apply_revenuecat_entitlement(
  uuid, uuid, text, timestamptz, timestamptz, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.apply_revenuecat_entitlement(
  uuid, uuid, text, timestamptz, timestamptz, text, text, jsonb, uuid, timestamptz
) to service_role;
