-- =============================================================================
-- Admin CMS v2 — product management at production scale
-- Additive only. Safe to re-run.
--
--   1. app_settings: product flags (PDF paywall stays OFF for dev)
--   2. books: published_at stamped by trigger, not by the client
--   3. admin_audit_log + write triggers on every CMS table
--   4. Admin read policies for library tables (counts, user detail)
--   5. admin_* views (joins, engagement counts) for list screens
--   6. Bulk / ordering / delete RPCs
--   7. plans: admin write policies (were missing)
--   8. entitlements: admin grant + revoke RPC
--   9. admin_user_directory v2 + admin_user_detail
--  10. admin_analytics + admin_storage_audit
--  11. admin_dashboard_stats, extended
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Product flags
-- -----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists maintenance_message text,
  add column if not exists signup_enabled boolean not null default true,
  add column if not exists min_supported_version text,
  add column if not exists support_email text,
  add column if not exists featured_collection_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_featured_collection_fk'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_featured_collection_fk
      foreign key (featured_collection_id)
      references public.collections (id) on delete set null;
  end if;
end;
$$;

create index if not exists app_settings_featured_collection_idx
  on public.app_settings (featured_collection_id);

-- -----------------------------------------------------------------------------
-- 2. published_at is server-owned
-- Stamped once on the first publish; cleared when a title is unpublished.
-- -----------------------------------------------------------------------------

create or replace function public.books_stamp_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_published and new.published_at is null then
    new.published_at := timezone('utc', now());
  elsif not new.is_published then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists books_stamp_published_at on public.books;
create trigger books_stamp_published_at
before insert or update of is_published, published_at on public.books
for each row execute function public.books_stamp_published_at();

-- A published title must have a PDF. NOT VALID so existing rows are untouched.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'books_published_needs_pdf'
      and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_published_needs_pdf
      check (not is_published or pdf_path is not null) not valid;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Audit log
-- -----------------------------------------------------------------------------

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint admin_audit_action_check check (action in ('insert', 'update', 'delete'))
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, created_at desc);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "audit_admin_read" on public.admin_audit_log;
create policy "audit_admin_read"
  on public.admin_audit_log for select
  to authenticated
  using ((select public.is_admin()));

grant select on table public.admin_audit_log to authenticated;
revoke insert, update, delete on table public.admin_audit_log from anon, authenticated;

-- Trigger writer. SECURITY DEFINER so it can insert past RLS.
create or replace function private.audit_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_row jsonb;
  v_key text;
  v_actor uuid := auth.uid();
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'search_vector')
        and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      end if;
    end loop;

    -- Nothing meaningful changed; do not write a row.
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.admin_audit_log (
    actor_id, actor_email, action, entity_type, entity_id, entity_label, changes
  )
  values (
    (select p.id from public.profiles p where p.id = v_actor),
    coalesce(auth.jwt() ->> 'email', 'system'),
    lower(tg_op),
    tg_table_name,
    nullif(v_row ->> 'id', ''),
    coalesce(
      v_row ->> 'title',
      v_row ->> 'name',
      v_row ->> 'label',
      v_row ->> 'code',
      v_row ->> 'full_name',
      tg_table_name
    ),
    v_changes
  );

  return null;
end;
$$;

revoke all on function private.audit_write() from public;
revoke all on function private.audit_write() from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'books', 'authors', 'categories', 'collections', 'plans', 'app_settings'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function private.audit_write()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- profiles churn on every self-edit, so only role changes earn a row.
drop trigger if exists profiles_role_audit on public.profiles;
create trigger profiles_role_audit
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute function private.audit_write();

-- -----------------------------------------------------------------------------
-- 4. Admin reads on library tables (engagement counts + user detail)
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'reading_progress', 'downloads', 'wishlist', 'highlights', 'reading_streaks'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select public.is_admin()))',
      t || '_admin_select', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. List views — everything a list screen renders, in one round trip
-- -----------------------------------------------------------------------------

create or replace view public.admin_book_rows
with (security_invoker = true) as
select
  b.id,
  b.slug,
  b.title,
  b.description,
  b.author_id,
  a.name as author_name,
  b.genre,
  b.tag,
  b.tags,
  b.rating,
  b.rating_count,
  b.price_cents,
  b.currency,
  b.format,
  b.cover_path,
  b.cover_color,
  b.cover_color_dark,
  b.pdf_path,
  b.file_size_bytes,
  b.read_time_minutes,
  b.is_premium,
  b.is_published,
  b.published_at,
  b.created_at,
  b.updated_at,
  coalesce(
    (select array_agg(bc.category_id) from public.book_categories bc where bc.book_id = b.id),
    '{}'::uuid[]
  ) as category_ids,
  coalesce(
    (select array_agg(cb.collection_id order by cb.sort_order)
     from public.collection_books cb where cb.book_id = b.id),
    '{}'::uuid[]
  ) as collection_ids,
  (select count(*)::int from public.reading_progress rp where rp.book_id = b.id) as reader_count,
  (select count(*)::int from public.downloads d
    where d.book_id = b.id and d.status = 'completed') as download_count,
  (select count(*)::int from public.wishlist w where w.book_id = b.id) as wishlist_count
from public.books b
join public.authors a on a.id = b.author_id;

grant select on table public.admin_book_rows to authenticated, service_role;

create or replace view public.admin_author_rows
with (security_invoker = true) as
select
  a.id, a.slug, a.name, a.bio, a.avatar_path, a.created_at, a.updated_at,
  (select count(*)::int from public.books b where b.author_id = a.id) as book_count,
  (select count(*)::int from public.books b
    where b.author_id = a.id and b.is_published) as published_count
from public.authors a;

grant select on table public.admin_author_rows to authenticated, service_role;

create or replace view public.admin_category_rows
with (security_invoker = true) as
select
  c.id, c.slug, c.label, c.icon_key, c.accent, c.accent_dark, c.sort_order, c.created_at,
  (select count(*)::int from public.book_categories bc where bc.category_id = c.id) as book_count
from public.categories c;

grant select on table public.admin_category_rows to authenticated, service_role;

create or replace view public.admin_collection_rows
with (security_invoker = true) as
select
  col.id, col.slug, col.title, col.subtitle, col.accent, col.kind,
  col.sort_order, col.is_published, col.created_at, col.updated_at,
  (select count(*)::int from public.collection_books cb
    where cb.collection_id = col.id) as book_count
from public.collections col;

grant select on table public.admin_collection_rows to authenticated, service_role;

create index if not exists books_updated_at_idx on public.books (updated_at desc);
create index if not exists books_created_at_idx on public.books (created_at desc);
create index if not exists books_title_sort_idx on public.books (title);

-- -----------------------------------------------------------------------------
-- 6. Bulk / ordering / delete RPCs
-- -----------------------------------------------------------------------------

-- Bulk publish, unpublish, or flip the premium badge.
-- Titles without a PDF are skipped rather than failing the whole batch.
create or replace function public.admin_bulk_update_books(
  p_ids uuid[],
  p_is_published boolean default null,
  p_is_premium boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int := 0;
  v_skipped int := 0;
  v_eligible uuid[];
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('updated', 0, 'skipped', 0);
  end if;

  if p_is_published is true then
    select coalesce(array_agg(b.id), '{}'::uuid[]) into v_eligible
    from public.books b
    where b.id = any (p_ids) and b.pdf_path is not null;

    v_skipped := array_length(p_ids, 1) - coalesce(array_length(v_eligible, 1), 0);
  else
    v_eligible := p_ids;
  end if;

  update public.books b
  set
    is_published = coalesce(p_is_published, b.is_published),
    is_premium = coalesce(p_is_premium, b.is_premium)
  where b.id = any (v_eligible);

  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.admin_bulk_update_books(uuid[], boolean, boolean) from public;
revoke execute on function public.admin_bulk_update_books(uuid[], boolean, boolean) from anon;
grant execute on function public.admin_bulk_update_books(uuid[], boolean, boolean)
  to authenticated, service_role;

-- Delete titles and hand back their storage objects so the client can purge them.
create or replace function public.admin_delete_books(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_covers text[];
  v_pdfs text[];
  v_deleted int := 0;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('deleted', 0, 'covers', '[]'::jsonb, 'pdfs', '[]'::jsonb);
  end if;

  select
    coalesce(array_agg(b.cover_path) filter (where b.cover_path is not null), '{}'::text[]),
    coalesce(array_agg(b.pdf_path) filter (where b.pdf_path is not null), '{}'::text[])
  into v_covers, v_pdfs
  from public.books b
  where b.id = any (p_ids);

  delete from public.books where id = any (p_ids);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'covers', to_jsonb(v_covers),
    'pdfs', to_jsonb(v_pdfs)
  );
end;
$$;

revoke all on function public.admin_delete_books(uuid[]) from public;
revoke execute on function public.admin_delete_books(uuid[]) from anon;
grant execute on function public.admin_delete_books(uuid[]) to authenticated, service_role;

-- Replace a collection's membership in one shot, preserving the given order.
create or replace function public.admin_set_collection_books(
  p_collection_id uuid,
  p_book_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  delete from public.collection_books
  where collection_id = p_collection_id
    and (p_book_ids is null or not (book_id = any (p_book_ids)));

  if p_book_ids is null or array_length(p_book_ids, 1) is null then
    return;
  end if;

  insert into public.collection_books (collection_id, book_id, sort_order)
  select p_collection_id, t.id, t.ord - 1
  from unnest(p_book_ids) with ordinality as t(id, ord)
  on conflict (collection_id, book_id)
  do update set sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.admin_set_collection_books(uuid, uuid[]) from public;
revoke execute on function public.admin_set_collection_books(uuid, uuid[]) from anon;
grant execute on function public.admin_set_collection_books(uuid, uuid[])
  to authenticated, service_role;

-- Same idea for a book's categories and collection memberships.
create or replace function public.admin_set_book_relations(
  p_book_id uuid,
  p_category_ids uuid[],
  p_collection_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  delete from public.book_categories
  where book_id = p_book_id
    and (p_category_ids is null or not (category_id = any (p_category_ids)));

  if p_category_ids is not null and array_length(p_category_ids, 1) is not null then
    insert into public.book_categories (book_id, category_id)
    select p_book_id, c.id from unnest(p_category_ids) as c(id)
    on conflict do nothing;
  end if;

  delete from public.collection_books
  where book_id = p_book_id
    and (p_collection_ids is null or not (collection_id = any (p_collection_ids)));

  if p_collection_ids is not null and array_length(p_collection_ids, 1) is not null then
    insert into public.collection_books (collection_id, book_id, sort_order)
    select cid, p_book_id, coalesce(
      (select max(cb.sort_order) + 1 from public.collection_books cb where cb.collection_id = cid),
      0
    )
    from unnest(p_collection_ids) as t(cid)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.admin_set_book_relations(uuid, uuid[], uuid[]) from public;
revoke execute on function public.admin_set_book_relations(uuid, uuid[], uuid[]) from anon;
grant execute on function public.admin_set_book_relations(uuid, uuid[], uuid[])
  to authenticated, service_role;

-- Persist a drag-reorder of categories or collections.
create or replace function public.admin_reorder(p_table text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_table not in ('categories', 'collections') then
    raise exception 'unsupported table';
  end if;

  execute format(
    'update public.%I t set sort_order = o.ord - 1
     from unnest($1) with ordinality as o(id, ord)
     where t.id = o.id',
    p_table
  ) using p_ids;
end;
$$;

revoke all on function public.admin_reorder(text, uuid[]) from public;
revoke execute on function public.admin_reorder(text, uuid[]) from anon;
grant execute on function public.admin_reorder(text, uuid[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. plans: admin writes (read policy already existed, writes did not)
-- -----------------------------------------------------------------------------

drop policy if exists "plans_admin_write" on public.plans;
create policy "plans_admin_write"
  on public.plans for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "plans_admin_update" on public.plans;
create policy "plans_admin_update"
  on public.plans for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "plans_admin_delete" on public.plans;
create policy "plans_admin_delete"
  on public.plans for delete
  to authenticated
  using ((select public.is_admin()));

grant insert, update, delete on table public.plans to authenticated;

-- -----------------------------------------------------------------------------
-- 8. entitlements: admin grant / revoke
-- RevenueCat still owns store purchases; this covers comps and support fixes.
-- -----------------------------------------------------------------------------

create or replace function public.admin_set_entitlement(
  p_user_id uuid,
  p_status text,
  p_plan_id uuid default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_status not in ('active', 'expired', 'cancelled', 'grace', 'billing_issue', 'trial') then
    raise exception 'invalid status';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into public.entitlements (
    user_id, plan_id, status, starts_at, expires_at, store
  )
  values (
    p_user_id,
    p_plan_id,
    p_status,
    timezone('utc', now()),
    p_expires_at,
    'promotional'
  )
  on conflict (user_id) do update
  set
    plan_id = excluded.plan_id,
    status = excluded.status,
    starts_at = coalesce(entitlements.starts_at, excluded.starts_at),
    expires_at = excluded.expires_at,
    store = case
      when entitlements.store in ('app_store', 'play_store', 'stripe')
        then entitlements.store
      else 'promotional'
    end;

  insert into public.admin_audit_log (
    actor_id, actor_email, action, entity_type, entity_id, entity_label, changes
  )
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', 'system'),
    'update',
    'entitlements',
    p_user_id::text,
    (select coalesce(full_name, email, id::text) from public.profiles where id = p_user_id),
    jsonb_build_object(
      'status', p_status,
      'plan_id', p_plan_id,
      'expires_at', p_expires_at
    )
  );
end;
$$;

revoke all on function public.admin_set_entitlement(uuid, text, uuid, timestamptz) from public;
revoke execute on function public.admin_set_entitlement(uuid, text, uuid, timestamptz) from anon;
grant execute on function public.admin_set_entitlement(uuid, text, uuid, timestamptz)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. People: directory v2 + per-user detail
-- -----------------------------------------------------------------------------

drop view if exists public.admin_user_directory;

create or replace view public.admin_user_directory
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.country,
  p.avatar_path,
  p.role,
  p.created_at,
  e.status as entitlement_status,
  e.starts_at,
  e.expires_at,
  e.store,
  pl.name as plan_name,
  pl.id as plan_id,
  (
    e.status = 'active'
    and (e.expires_at is null or e.expires_at > timezone('utc', now()))
  ) as is_subscriber,
  (select count(*)::int from public.reading_progress rp where rp.user_id = p.id) as books_started,
  (select count(*)::int from public.reading_progress rp
    where rp.user_id = p.id and rp.progress >= 0.99) as books_finished,
  (select count(*)::int from public.downloads d
    where d.user_id = p.id and d.status = 'completed') as downloads_count,
  (select max(rp.last_read_at) from public.reading_progress rp where rp.user_id = p.id)
    as last_read_at
from public.profiles p
left join public.entitlements e on e.user_id = p.id
left join public.plans pl on pl.id = e.plan_id;

grant select on table public.admin_user_directory to authenticated, service_role;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'profile', (
      select to_jsonb(d) from public.admin_user_directory d where d.id = p_user_id
    ),
    'streak', (
      select jsonb_build_object(
        'current_streak', s.current_streak,
        'longest_streak', s.longest_streak,
        'last_read_date', s.last_read_date
      )
      from public.reading_streaks s where s.user_id = p_user_id
    ),
    'reading', coalesce((
      select jsonb_agg(entry)
      from (
        select jsonb_build_object(
          'book_id', b.id,
          'title', b.title,
          'cover_path', b.cover_path,
          'cover_color', b.cover_color,
          'progress', rp.progress,
          'current_page', rp.current_page,
          'last_read_at', rp.last_read_at
        ) as entry
        from public.reading_progress rp
        join public.books b on b.id = rp.book_id
        where rp.user_id = p_user_id
        order by rp.last_read_at desc
        limit 20
      ) t
    ), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(entry)
      from (
        select jsonb_build_object(
          'book_id', b.id,
          'title', b.title,
          'status', d.status,
          'file_size_bytes', d.file_size_bytes,
          'downloaded_at', d.downloaded_at
        ) as entry
        from public.downloads d
        join public.books b on b.id = d.book_id
        where d.user_id = p_user_id
        order by d.downloaded_at desc
        limit 20
      ) t
    ), '[]'::jsonb),
    'wishlist_count', (
      select count(*)::int from public.wishlist w where w.user_id = p_user_id
    ),
    'highlight_count', (
      select count(*)::int from public.highlights h where h.user_id = p_user_id
    )
  );
end;
$$;

revoke all on function public.admin_user_detail(uuid) from public;
revoke execute on function public.admin_user_detail(uuid) from anon;
grant execute on function public.admin_user_detail(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Analytics + storage housekeeping
-- -----------------------------------------------------------------------------

create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from date := (timezone('utc', now()))::date - (v_days - 1);
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'signups', (
      select coalesce(
        jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'value', s.n)
          order by d.day), '[]'::jsonb)
      from generate_series(
        v_from::timestamp, (timezone('utc', now()))::date::timestamp, interval '1 day'
      ) as d(day)
      left join lateral (
        select count(*)::int as n from public.profiles p
        where (p.created_at at time zone 'utc')::date = d.day::date
      ) s on true
    ),
    'reads', (
      select coalesce(
        jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'value', s.n)
          order by d.day), '[]'::jsonb)
      from generate_series(
        v_from::timestamp, (timezone('utc', now()))::date::timestamp, interval '1 day'
      ) as d(day)
      left join lateral (
        select count(*)::int as n from public.reading_progress rp
        where (rp.last_read_at at time zone 'utc')::date = d.day::date
      ) s on true
    ),
    'downloads', (
      select coalesce(
        jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'value', s.n)
          order by d.day), '[]'::jsonb)
      from generate_series(
        v_from::timestamp, (timezone('utc', now()))::date::timestamp, interval '1 day'
      ) as d(day)
      left join lateral (
        select count(*)::int as n from public.downloads dl
        where dl.status = 'completed'
          and (dl.downloaded_at at time zone 'utc')::date = d.day::date
      ) s on true
    ),
    'top_books', coalesce((
      select jsonb_agg(entry)
      from (
        select jsonb_build_object(
          'book_id', b.id,
          'title', b.title,
          'author_name', a.name,
          'cover_path', b.cover_path,
          'cover_color', b.cover_color,
          'readers', count(rp.user_id)::int,
          'avg_progress', round(coalesce(avg(rp.progress), 0)::numeric, 3)
        ) as entry
        from public.books b
        join public.authors a on a.id = b.author_id
        left join public.reading_progress rp on rp.book_id = b.id
        group by b.id, a.name
        having count(rp.user_id) > 0
        order by count(rp.user_id) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_categories', coalesce((
      select jsonb_agg(entry)
      from (
        select jsonb_build_object(
          'category_id', c.id,
          'label', c.label,
          'accent', c.accent,
          'book_count', count(distinct bc.book_id)::int,
          'readers', count(rp.user_id)::int
        ) as entry
        from public.categories c
        left join public.book_categories bc on bc.category_id = c.id
        left join public.reading_progress rp on rp.book_id = bc.book_id
        group by c.id
        order by count(rp.user_id) desc, count(distinct bc.book_id) desc
        limit 8
      ) t
    ), '[]'::jsonb),
    'catalog', jsonb_build_object(
      'published', (select count(*)::int from public.books where is_published),
      'draft', (select count(*)::int from public.books where not is_published),
      'missing_pdf', (select count(*)::int from public.books where pdf_path is null),
      'missing_cover', (select count(*)::int from public.books where cover_path is null),
      'premium', (select count(*)::int from public.books where is_premium and is_published)
    ),
    'audience', jsonb_build_object(
      'total', (select count(*)::int from public.profiles),
      'admins', (select count(*)::int from public.profiles where role = 'admin'),
      'subscribers', (
        select count(*)::int from public.entitlements e
        where e.status = 'active'
          and (e.expires_at is null or e.expires_at > timezone('utc', now()))
      ),
      'new_in_period', (
        select count(*)::int from public.profiles p where p.created_at >= v_from
      ),
      'active_in_period', (
        select count(distinct rp.user_id)::int from public.reading_progress rp
        where rp.last_read_at >= v_from
      )
    )
  );
end;
$$;

revoke all on function public.admin_analytics(integer) from public;
revoke execute on function public.admin_analytics(integer) from anon;
grant execute on function public.admin_analytics(integer) to authenticated, service_role;

-- Storage objects no book points at, plus books pointing at missing objects.
create or replace function public.admin_storage_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'orphans', coalesce((
      select jsonb_agg(entry)
      from (
        select jsonb_build_object(
          'bucket', o.bucket_id,
          'name', o.name,
          'size', (o.metadata ->> 'size')::bigint,
          'created_at', o.created_at
        ) as entry
        from storage.objects o
        where o.bucket_id in ('covers', 'pdfs')
          and not exists (
            select 1 from public.books b
            where regexp_replace(coalesce(b.cover_path, ''), '^covers/', '') = o.name
               or regexp_replace(coalesce(b.pdf_path, ''), '^pdfs/', '') = o.name
          )
          and not exists (
            select 1 from public.authors a
            where regexp_replace(coalesce(a.avatar_path, ''), '^covers/', '') = o.name
          )
        order by o.created_at desc
        limit 200
      ) t
    ), '[]'::jsonb),
    -- Filter before LIMIT, otherwise a healthy catalog hides the broken tail.
    'broken', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'book_id', t.id,
          'title', t.title,
          'missing_cover', t.missing_cover,
          'missing_pdf', t.missing_pdf
        )
        order by t.updated_at desc
      )
      from (
        select
          b.id,
          b.title,
          b.updated_at,
          b.cover_path is not null and not exists (
            select 1 from storage.objects o
            where o.bucket_id = 'covers'
              and o.name = regexp_replace(b.cover_path, '^covers/', '')
          ) as missing_cover,
          b.pdf_path is not null and not exists (
            select 1 from storage.objects o
            where o.bucket_id = 'pdfs'
              and o.name = regexp_replace(b.pdf_path, '^pdfs/', '')
          ) as missing_pdf
        from public.books b
        where b.cover_path is not null or b.pdf_path is not null
      ) t
      where t.missing_cover or t.missing_pdf
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'covers_bytes', coalesce(sum((o.metadata ->> 'size')::bigint)
          filter (where o.bucket_id = 'covers'), 0),
        'pdfs_bytes', coalesce(sum((o.metadata ->> 'size')::bigint)
          filter (where o.bucket_id = 'pdfs'), 0),
        'covers_count', count(*) filter (where o.bucket_id = 'covers')::int,
        'pdfs_count', count(*) filter (where o.bucket_id = 'pdfs')::int
      )
      from storage.objects o
      where o.bucket_id in ('covers', 'pdfs')
    )
  );
end;
$$;

revoke all on function public.admin_storage_audit() from public;
revoke execute on function public.admin_storage_audit() from anon;
grant execute on function public.admin_storage_audit() to authenticated, service_role;

-- Delete a storage object the admin panel flagged as orphaned.
create or replace function public.admin_delete_storage_object(p_bucket text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_bucket not in ('covers', 'pdfs') then
    raise exception 'unsupported bucket';
  end if;

  if exists (
    select 1 from public.books b
    where regexp_replace(coalesce(b.cover_path, ''), '^covers/', '') = p_name
       or regexp_replace(coalesce(b.pdf_path, ''), '^pdfs/', '') = p_name
  ) then
    raise exception 'object is still referenced by a book';
  end if;

  delete from storage.objects where bucket_id = p_bucket and name = p_name;
end;
$$;

revoke all on function public.admin_delete_storage_object(text, text) from public;
revoke execute on function public.admin_delete_storage_object(text, text) from anon;
grant execute on function public.admin_delete_storage_object(text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Dashboard stats — extended, single round trip
-- -----------------------------------------------------------------------------

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'user_count', (select count(*)::int from public.profiles),
    'admin_count', (select count(*)::int from public.profiles where role = 'admin'),
    'subscriber_count', (
      select count(*)::int
      from public.entitlements e
      where e.status = 'active'
        and (e.expires_at is null or e.expires_at > timezone('utc', now()))
    ),
    'guest_signed_in_count', (
      select count(*)::int
      from public.profiles p
      where p.role is distinct from 'admin'
        and not exists (
          select 1
          from public.entitlements e
          where e.user_id = p.id
            and e.status = 'active'
            and (e.expires_at is null or e.expires_at > timezone('utc', now()))
        )
    ),
    'book_published_count', (select count(*)::int from public.books where is_published),
    'book_draft_count', (select count(*)::int from public.books where not is_published),
    'author_count', (select count(*)::int from public.authors),
    'category_count', (select count(*)::int from public.categories),
    'collection_count', (select count(*)::int from public.collections),
    'plan_count', (select count(*)::int from public.plans where is_active),
    'download_completed_count', (
      select count(*)::int from public.downloads where status = 'completed'
    ),
    'missing_pdf_count', (select count(*)::int from public.books where pdf_path is null),
    'missing_cover_count', (select count(*)::int from public.books where cover_path is null),
    'signups_7d', (
      select count(*)::int from public.profiles
      where created_at >= timezone('utc', now()) - interval '7 days'
    ),
    'reads_7d', (
      select count(*)::int from public.reading_progress
      where last_read_at >= timezone('utc', now()) - interval '7 days'
    ),
    'downloads_7d', (
      select count(*)::int from public.downloads
      where status = 'completed'
        and downloaded_at >= timezone('utc', now()) - interval '7 days'
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
revoke execute on function public.admin_dashboard_stats() from anon;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;
