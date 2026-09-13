-- App Store and Play product ids often differ. Keep revenuecat_product_id as the
-- shared / legacy alias; webhook matches event.product_id against any of the three.

alter table public.plans
  add column if not exists app_store_product_id text,
  add column if not exists play_store_product_id text;

comment on column public.plans.revenuecat_product_id is
  'Legacy / shared store or RC product id. Prefer app_store_product_id and play_store_product_id when SKUs differ.';
comment on column public.plans.app_store_product_id is
  'App Store Connect subscription product id (StoreKit). Matched from RevenueCat event.product_id when store is APP_STORE.';
comment on column public.plans.play_store_product_id is
  'Google Play subscription product id. Matched from RevenueCat event.product_id when store is PLAY_STORE. Google Pay is a Play Billing payment method, not a separate product.';

-- Backfill from the shared column when store-specific ids are still empty.
update public.plans
set
  app_store_product_id = coalesce(app_store_product_id, revenuecat_product_id),
  play_store_product_id = coalesce(play_store_product_id, revenuecat_product_id)
where revenuecat_product_id is not null
  and (
    app_store_product_id is null
    or play_store_product_id is null
  );

create unique index if not exists plans_app_store_product_id_uidx
  on public.plans (app_store_product_id)
  where app_store_product_id is not null;

create unique index if not exists plans_play_store_product_id_uidx
  on public.plans (play_store_product_id)
  where play_store_product_id is not null;

create unique index if not exists plans_revenuecat_product_id_uidx
  on public.plans (revenuecat_product_id)
  where revenuecat_product_id is not null;

-- New optional store-SKU args change the signature; drop the prior overload.
drop function if exists public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, boolean, integer
);

create or replace function public.admin_upsert_plan(
  p_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_price_cents integer default null,
  p_currency text default null,
  p_interval text default null,
  p_features jsonb default null,
  p_revenuecat_product_id text default null,
  p_app_store_product_id text default null,
  p_play_store_product_id text default null,
  p_is_active boolean default null,
  p_sort_order integer default null
)
returns public.plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.plans;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_interval is not null and p_interval not in ('month', 'year', 'lifetime') then
    raise exception 'interval must be month, year or lifetime' using errcode = '22023';
  end if;

  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'price_cents must be >= 0' using errcode = '22023';
  end if;

  if p_features is not null and jsonb_typeof(p_features) <> 'array' then
    raise exception 'features must be a JSON array' using errcode = '22023';
  end if;

  if p_id is null then
    if p_code is null or length(trim(p_code)) = 0 then
      raise exception 'code is required' using errcode = '22023';
    end if;

    if p_name is null or length(trim(p_name)) = 0 then
      raise exception 'name is required' using errcode = '22023';
    end if;

    if p_price_cents is null then
      raise exception 'price_cents is required' using errcode = '22023';
    end if;

    insert into public.plans (
      code, name, price_cents, currency, interval, features,
      revenuecat_product_id, app_store_product_id, play_store_product_id,
      is_active, sort_order
    )
    values (
      trim(p_code),
      trim(p_name),
      p_price_cents,
      coalesce(nullif(trim(p_currency), ''), 'PKR'),
      coalesce(p_interval, 'month'),
      coalesce(p_features, '[]'::jsonb),
      nullif(trim(p_revenuecat_product_id), ''),
      nullif(trim(p_app_store_product_id), ''),
      nullif(trim(p_play_store_product_id), ''),
      coalesce(p_is_active, true),
      coalesce(p_sort_order, 0)
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.plans p
  set
    code = coalesce(nullif(trim(p_code), ''), p.code),
    name = coalesce(nullif(trim(p_name), ''), p.name),
    price_cents = coalesce(p_price_cents, p.price_cents),
    currency = coalesce(nullif(trim(p_currency), ''), p.currency),
    interval = coalesce(p_interval, p.interval),
    features = coalesce(p_features, p.features),
    revenuecat_product_id = coalesce(
      nullif(trim(p_revenuecat_product_id), ''),
      p.revenuecat_product_id
    ),
    app_store_product_id = coalesce(
      nullif(trim(p_app_store_product_id), ''),
      p.app_store_product_id
    ),
    play_store_product_id = coalesce(
      nullif(trim(p_play_store_product_id), ''),
      p.play_store_product_id
    ),
    is_active = coalesce(p_is_active, p.is_active),
    sort_order = coalesce(p_sort_order, p.sort_order)
  where p.id = p_id
  returning * into v_row;

  if not found then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, text, text, boolean, integer
) from public;
grant execute on function public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, text, text, boolean, integer
) to authenticated, service_role;

create or replace view public.admin_plan_rows
with (security_invoker = true)
as
select
  p.id,
  p.code,
  p.name,
  p.price_cents,
  p.currency,
  p.interval,
  p.features,
  p.revenuecat_product_id,
  p.app_store_product_id,
  p.play_store_product_id,
  p.is_active,
  p.sort_order,
  p.created_at,
  p.updated_at,
  (select count(*)::int from public.entitlements e where e.plan_id = p.id) as entitlement_count
from public.plans p;

grant select on table public.admin_plan_rows to authenticated, service_role;
