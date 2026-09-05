-- pgAdmin twin of 20260905120000_release_hardening.sql
-- Prefer supabase/migrations via `db push` for staging/production.

-- Release hardening.
--
-- Everything here closes a gap called out in docs/backend-audit-remaining-work.md:
--
--   1. storage existence checks, so a book cannot be published against a
--      pdf_path that has no object behind it
--   2. search_books() clamps its own limit/offset, so a direct RPC caller
--      cannot ask for a million rows
--   3. the audit log attributes writes made through the service-role key to the
--      admin who made them instead of to "system"
--   4. category / collection / plan CRUD as SECURITY DEFINER RPCs, so day-to-day
--      CMS work stops needing raw SQL and stays audited under the real actor
--
-- Safe to run twice.

-- -----------------------------------------------------------------------------
-- 1. Storage existence
-- -----------------------------------------------------------------------------
-- books.pdf_path / cover_path are stored inconsistently across the import
-- script, the CMS and hand-written SQL: some rows carry the bucket prefix
-- ("pdfs/x.pdf"), some do not ("x.pdf"), some carry a leading slash. Storage
-- keys never carry the bucket, so normalise before comparing rather than
-- teaching every caller the rule.

create or replace function public.storage_object_key(p_bucket text, p_path text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    regexp_replace(
      regexp_replace(coalesce(p_path, ''), '^/+', ''),
      '^' || p_bucket || '/',
      ''
    ),
    ''
  );
$$;

-- SECURITY DEFINER: storage.objects is not readable by authenticated, and this
-- deliberately answers one boolean rather than exposing the object listing.
create or replace function public.storage_object_exists(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
parallel safe
set search_path = public, storage
as $$
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = p_bucket
      and o.name = public.storage_object_key(p_bucket, p_path)
  );
$$;

revoke all on function public.storage_object_key(text, text) from public;
revoke all on function public.storage_object_exists(text, text) from public;
revoke execute on function public.storage_object_exists(text, text) from anon;
grant execute on function public.storage_object_key(text, text)
  to authenticated, service_role;
grant execute on function public.storage_object_exists(text, text)
  to authenticated, service_role;

-- Publish readiness in one place. The Edge Functions and the bulk RPC both call
-- this, so "can this book go live?" has exactly one answer.
create or replace function public.book_publish_blocker(p_book_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pdf_path text;
  v_found boolean;
begin
  select b.pdf_path into v_pdf_path
  from public.books b
  where b.id = p_book_id;

  if not found then
    return 'NOT_FOUND';
  end if;

  if v_pdf_path is null or length(trim(v_pdf_path)) = 0 then
    return 'PDF_PATH_MISSING';
  end if;

  select public.storage_object_exists('pdfs', v_pdf_path) into v_found;

  if not v_found then
    return 'PDF_NOT_IN_STORAGE';
  end if;

  return null;
end;
$$;

revoke all on function public.book_publish_blocker(uuid) from public;
revoke execute on function public.book_publish_blocker(uuid) from anon;
grant execute on function public.book_publish_blocker(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Bulk publish respects storage
-- -----------------------------------------------------------------------------
-- Previously a bulk publish only checked that pdf_path was non-null, so a batch
-- could put titles live whose file had never been uploaded. Ineligible ids now
-- come back by id and reason so the CMS can say which ones were skipped and why.

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
  v_eligible uuid[] := '{}'::uuid[];
  v_skipped jsonb := '[]'::jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('updated', 0, 'skipped', 0, 'skippedBooks', '[]'::jsonb);
  end if;

  if p_is_published is true then
    with checked as (
      select
        t.id,
        public.book_publish_blocker(t.id) as blocker
      from unnest(p_ids) as t(id)
    )
    select
      coalesce(array_agg(c.id) filter (where c.blocker is null), '{}'::uuid[]),
      coalesce(
        jsonb_agg(jsonb_build_object('id', c.id, 'reason', c.blocker))
          filter (where c.blocker is not null),
        '[]'::jsonb
      )
    into v_eligible, v_skipped
    from checked c;
  else
    v_eligible := p_ids;
  end if;

  update public.books b
  set
    is_published = coalesce(p_is_published, b.is_published),
    is_premium = coalesce(p_is_premium, b.is_premium)
  where b.id = any (v_eligible);

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'updated', v_updated,
    'skipped', jsonb_array_length(v_skipped),
    'skippedBooks', v_skipped
  );
end;
$$;

revoke all on function public.admin_bulk_update_books(uuid[], boolean, boolean) from public;
revoke execute on function public.admin_bulk_update_books(uuid[], boolean, boolean) from anon;
grant execute on function public.admin_bulk_update_books(uuid[], boolean, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. search_books() clamps its own window
-- -----------------------------------------------------------------------------
-- The Edge Function caps page size at 100, but search_books() is granted to
-- anon and authenticated and is reachable directly through the Data API. A
-- caller asking for limit 1e9 previously got a full materialisation. The offset
-- ceiling exists for the same reason: a deep offset scans and discards every
-- preceding row.

create or replace function public.search_books(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  title text,
  author_name text,
  author_id uuid,
  cover_path text,
  cover_color text,
  cover_color_dark text,
  rating numeric,
  tag text,
  genre text,
  read_time_minutes integer,
  price_cents integer,
  currency text,
  format text,
  is_premium boolean,
  published_at timestamptz,
  total_count bigint
)
language sql
stable
parallel safe
security invoker
set search_path = public
as $$
  with bounds as (
    select
      least(greatest(coalesce(p_limit, 20), 1), 100) as lim,
      least(greatest(coalesce(p_offset, 0), 0), 10000) as off
  ),
  q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  )
  select
    b.id,
    b.slug,
    b.title,
    a.name as author_name,
    a.id as author_id,
    b.cover_path,
    b.cover_color,
    b.cover_color_dark,
    b.rating,
    b.tag,
    b.genre,
    b.read_time_minutes,
    b.price_cents,
    b.currency,
    b.format,
    b.is_premium,
    b.published_at,
    count(*) over () as total_count
  from public.books b
  left join public.authors a on a.id = b.author_id
  cross join q
  where b.is_published = true
    -- An empty or stopword-only tsquery already matches nothing through the
    -- GIN index, so no explicit guard is needed. Comparing against ''::tsquery
    -- would emit a NOTICE into the database log on every single search.
    and b.search_vector @@ q.tsq
  order by
    ts_rank(b.search_vector, q.tsq) desc,
    b.published_at desc nulls last,
    b.id
  limit (select lim from bounds)
  offset (select off from bounds);
$$;

revoke all on function public.search_books(text, integer, integer) from public;
grant execute on function public.search_books(text, integer, integer)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Audit attribution through the service-role key
-- -----------------------------------------------------------------------------
-- The admin Edge Functions write with the service-role key after requireAdmin()
-- has passed, so auth.uid() was null inside the trigger and every CMS change was
-- logged as "system". That makes "who published this?" unanswerable.
--
-- The Edge Functions now send the verified caller as x-audit-actor-id /
-- x-audit-actor-email, and this trigger trusts those headers ONLY when the
-- request authenticated as service_role. An app client authenticates as anon or
-- authenticated, cannot reach that branch, and has no write grant on any audited
-- table regardless.

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
  v_email text := auth.jwt() ->> 'email';
  v_headers json;
begin
  if v_actor is null
     and (
       coalesce(auth.jwt() ->> 'role', '') = 'service_role'
       or coalesce(current_setting('role', true), '') = 'service_role'
     )
  then
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
      v_headers := null;
    end;

    if v_headers is not null then
      begin
        v_actor := nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
      exception when others then
        v_actor := null;
      end;

      v_email := coalesce(nullif(v_headers ->> 'x-audit-actor-email', ''), v_email);
    end if;
  end if;

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
    coalesce(v_email, 'system'),
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

-- -----------------------------------------------------------------------------
-- 5. Category CRUD
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER and called with the caller's own JWT (never the service-role
-- key), so is_admin() sees the real user and the audit trigger records them.

create or replace function public.admin_upsert_category(
  p_id uuid default null,
  p_label text default null,
  p_slug text default null,
  p_icon_key text default null,
  p_accent text default null,
  p_accent_dark text default null,
  p_sort_order integer default null
)
returns public.categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.categories;
  v_slug text;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_id is null then
    if p_label is null or length(trim(p_label)) = 0 then
      raise exception 'label is required' using errcode = '22023';
    end if;

    v_slug := coalesce(nullif(public.slugify(p_slug), ''), public.slugify(p_label));

    if v_slug is null or v_slug = '' then
      raise exception 'slug could not be derived' using errcode = '22023';
    end if;

    insert into public.categories (slug, label, icon_key, accent, accent_dark, sort_order)
    values (
      v_slug,
      trim(p_label),
      coalesce(nullif(trim(p_icon_key), ''), 'book'),
      p_accent,
      p_accent_dark,
      coalesce(p_sort_order, 0)
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.categories c
  set
    label = coalesce(nullif(trim(p_label), ''), c.label),
    slug = coalesce(nullif(public.slugify(p_slug), ''), c.slug),
    icon_key = coalesce(nullif(trim(p_icon_key), ''), c.icon_key),
    accent = coalesce(p_accent, c.accent),
    accent_dark = coalesce(p_accent_dark, c.accent_dark),
    sort_order = coalesce(p_sort_order, c.sort_order)
  where c.id = p_id
  returning * into v_row;

  if not found then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- Deleting a category cascades book_categories, which would silently strip
-- books out of browse. Refuse while any book still uses it; the caller can
-- reassign first or pass p_force.
create or replace function public.admin_delete_category(
  p_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_books int;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select count(*) into v_books
  from public.book_categories bc
  where bc.category_id = p_id;

  if v_books > 0 and not p_force then
    raise exception 'category still has % book(s)', v_books using errcode = '23503';
  end if;

  delete from public.categories where id = p_id;

  if not found then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_id, 'detachedBooks', v_books);
end;
$$;

revoke all on function
  public.admin_upsert_category(uuid, text, text, text, text, text, integer) from public;
revoke execute on function
  public.admin_upsert_category(uuid, text, text, text, text, text, integer) from anon;
grant execute on function
  public.admin_upsert_category(uuid, text, text, text, text, text, integer)
  to authenticated, service_role;

revoke all on function public.admin_delete_category(uuid, boolean) from public;
revoke execute on function public.admin_delete_category(uuid, boolean) from anon;
grant execute on function public.admin_delete_category(uuid, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Collection CRUD
-- -----------------------------------------------------------------------------

create or replace function public.admin_upsert_collection(
  p_id uuid default null,
  p_title text default null,
  p_slug text default null,
  p_subtitle text default null,
  p_accent text default null,
  p_kind text default null,
  p_sort_order integer default null,
  p_is_published boolean default null
)
returns public.collections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.collections;
  v_slug text;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_kind is not null and p_kind not in ('hero', 'shelf', 'carousel') then
    raise exception 'kind must be hero, shelf or carousel' using errcode = '22023';
  end if;

  if p_id is null then
    if p_title is null or length(trim(p_title)) = 0 then
      raise exception 'title is required' using errcode = '22023';
    end if;

    v_slug := coalesce(nullif(public.slugify(p_slug), ''), public.slugify(p_title));

    if v_slug is null or v_slug = '' then
      raise exception 'slug could not be derived' using errcode = '22023';
    end if;

    insert into public.collections (slug, title, subtitle, accent, kind, sort_order, is_published)
    values (
      v_slug,
      trim(p_title),
      p_subtitle,
      p_accent,
      coalesce(p_kind, 'shelf'),
      coalesce(p_sort_order, 0),
      coalesce(p_is_published, true)
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.collections c
  set
    title = coalesce(nullif(trim(p_title), ''), c.title),
    slug = coalesce(nullif(public.slugify(p_slug), ''), c.slug),
    subtitle = coalesce(p_subtitle, c.subtitle),
    accent = coalesce(p_accent, c.accent),
    kind = coalesce(p_kind, c.kind),
    sort_order = coalesce(p_sort_order, c.sort_order),
    is_published = coalesce(p_is_published, c.is_published)
  where c.id = p_id
  returning * into v_row;

  if not found then
    raise exception 'collection not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- app_settings.featured_collection_id is ON DELETE SET NULL, so deleting the
-- hero shelf would quietly empty the Home screen. Say so instead.
create or replace function public.admin_delete_collection(
  p_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_books int;
  v_featured boolean;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.app_settings s
    where s.id = 1 and s.featured_collection_id = p_id
  ) into v_featured;

  if v_featured and not p_force then
    raise exception 'collection is the featured collection' using errcode = '23503';
  end if;

  select count(*) into v_books
  from public.collection_books cb
  where cb.collection_id = p_id;

  delete from public.collections where id = p_id;

  if not found then
    raise exception 'collection not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', p_id,
    'detachedBooks', v_books,
    'wasFeatured', v_featured
  );
end;
$$;

revoke all on function
  public.admin_upsert_collection(uuid, text, text, text, text, text, integer, boolean)
  from public;
revoke execute on function
  public.admin_upsert_collection(uuid, text, text, text, text, text, integer, boolean)
  from anon;
grant execute on function
  public.admin_upsert_collection(uuid, text, text, text, text, text, integer, boolean)
  to authenticated, service_role;

revoke all on function public.admin_delete_collection(uuid, boolean) from public;
revoke execute on function public.admin_delete_collection(uuid, boolean) from anon;
grant execute on function public.admin_delete_collection(uuid, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Plan CRUD
-- -----------------------------------------------------------------------------
-- plans.code is what RevenueCat products map onto, so changing it re-points
-- billing. Deleting a plan that entitlements still reference nulls their
-- plan_id (ON DELETE SET NULL) and loses the mapping; refuse unless forced.

create or replace function public.admin_upsert_plan(
  p_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_price_cents integer default null,
  p_currency text default null,
  p_interval text default null,
  p_features jsonb default null,
  p_revenuecat_product_id text default null,
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
      revenuecat_product_id, is_active, sort_order
    )
    values (
      trim(p_code),
      trim(p_name),
      p_price_cents,
      coalesce(nullif(trim(p_currency), ''), 'PKR'),
      coalesce(p_interval, 'month'),
      coalesce(p_features, '[]'::jsonb),
      nullif(trim(p_revenuecat_product_id), ''),
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

create or replace function public.admin_delete_plan(
  p_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlements int;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select count(*) into v_entitlements
  from public.entitlements e
  where e.plan_id = p_id;

  if v_entitlements > 0 and not p_force then
    raise exception 'plan is referenced by % entitlement(s)', v_entitlements
      using errcode = '23503';
  end if;

  delete from public.plans where id = p_id;

  if not found then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_id, 'detachedEntitlements', v_entitlements);
end;
$$;

revoke all on function public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, boolean, integer
) from public;
revoke execute on function public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, boolean, integer
) from anon;
grant execute on function public.admin_upsert_plan(
  uuid, text, text, integer, text, text, jsonb, text, boolean, integer
) to authenticated, service_role;

revoke all on function public.admin_delete_plan(uuid, boolean) from public;
revoke execute on function public.admin_delete_plan(uuid, boolean) from anon;
grant execute on function public.admin_delete_plan(uuid, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Admin plan rows (list view, including inactive)
-- -----------------------------------------------------------------------------
-- plans_public_read_active hides inactive plans from the app, so the CMS cannot
-- page the catalog through plans-list. security_invoker = true matches the other
-- admin_* views: the admin Edge Function reads it with the service-role key,
-- which is only reachable after requireAdmin() has passed.

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
  p.is_active,
  p.sort_order,
  p.created_at,
  p.updated_at,
  (select count(*)::int from public.entitlements e where e.plan_id = p.id) as entitlement_count
from public.plans p;

grant select on table public.admin_plan_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Indexes for the paths added above
-- -----------------------------------------------------------------------------
-- admin_delete_plan and admin_plan_rows both count entitlements by plan, and
-- entitlements.plan_id had no index (foreign keys do not create one).

create index if not exists entitlements_plan_id_idx
  on public.entitlements (plan_id)
  where plan_id is not null;

-- book_categories/collection_books are scanned from the category and collection
-- side by the delete guards above; only the leading PK column was indexed.
create index if not exists book_categories_category_id_idx
  on public.book_categories (category_id);

create index if not exists collection_books_book_id_idx
  on public.collection_books (book_id);
