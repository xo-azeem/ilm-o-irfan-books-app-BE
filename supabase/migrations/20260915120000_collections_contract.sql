-- =============================================================================
-- One source per shelf: Home rails and collection pages read the same list
--
-- home-feed built `shelves.trending` from the weekly draw and `newArrivals`
-- from collection_shelf() with a newest-published fallback, while
-- collection-books paged collection_books for every slug. The `trending` and
-- `new-arrivals` rows have no curated members, so tapping "See all" on a full
-- rail opened an empty page. Both endpoints now go through collection_page()
-- below, which decides the source once, in SQL.
--
-- Also here: collection_summaries.book_count counted draft members,
-- admin_collection_rows could not tell an admin how many of a collection's
-- books are live, and nothing stopped the three system shelves from being
-- deleted out from under Home. And the two demo collections from seed.sql go.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The system shelves, named once
-- -----------------------------------------------------------------------------

-- home-feed renders these three by slug. They are rows in `collections` so an
-- admin can retitle, re-subtitle, reorder or hide them, but the slug is the
-- contract and the row must exist.
create or replace function public.system_collection_slugs()
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select array['home-hero', 'trending', 'new-arrivals'];
$fn$;

comment on function public.system_collection_slugs() is
  'Slugs of the collections home-feed renders as its own rails. Cannot be deleted or re-slugged.';

revoke all on function public.system_collection_slugs() from public;
grant execute on function public.system_collection_slugs() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Guard: system shelves can be edited and hidden, not deleted or re-slugged
-- -----------------------------------------------------------------------------

-- A trigger rather than a narrower RLS policy because a policy that excludes
-- the row makes DELETE return "0 rows" and the CMS would report success.
-- 23503 is the same SQLSTATE admin_delete_collection() already raises for "the
-- featured collection", so both PostgREST (409) and failFromRpcError (CONFLICT)
-- surface it the same way.
create or replace function public.collections_guard_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    if old.slug = any (public.system_collection_slugs()) then
      raise exception 'system collection "%" cannot be deleted; unpublish it instead', old.slug
        using errcode = '23503';
    end if;
    return old;
  end if;

  if old.slug = any (public.system_collection_slugs())
     and new.slug is distinct from old.slug then
    raise exception 'system collection "%" cannot change its slug', old.slug
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

drop trigger if exists collections_guard_system on public.collections;
create trigger collections_guard_system
before update or delete on public.collections
for each row execute function public.collections_guard_system();

-- The RPC path checks first so the message does not depend on trigger order.
create or replace function public.admin_delete_collection(
  p_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_slug text;
  v_books int;
  v_featured boolean;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select c.slug into v_slug from public.collections c where c.id = p_id;

  if v_slug is null then
    raise exception 'collection not found' using errcode = 'P0002';
  end if;

  if v_slug = any (public.system_collection_slugs()) then
    raise exception 'system collection "%" cannot be deleted; unpublish it instead', v_slug
      using errcode = '23503';
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

  return jsonb_build_object(
    'id', p_id,
    'detachedBooks', v_books,
    'wasFeatured', v_featured
  );
end;
$fn$;

-- Grants are unchanged from 20260905120000 / 20260913130000; restated because
-- create or replace keeps them but the intent should be readable here.
revoke all on function public.admin_delete_collection(uuid, boolean) from public;
revoke execute on function public.admin_delete_collection(uuid, boolean) from anon;
grant execute on function public.admin_delete_collection(uuid, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Views: published counts, and is_system so the strip can skip the rails
-- -----------------------------------------------------------------------------

-- The left join on books already filtered is_published, but count(cb.book_id)
-- counted the junction row regardless, so a shelf full of drafts showed
-- "12 books" on the strip and opened empty. count(b.id) is the published
-- count. is_system is appended, so nothing selecting by position shifts.
create or replace view public.collection_summaries
with (security_invoker = true)
as
select
  col.id,
  col.slug,
  col.title,
  col.subtitle,
  col.accent,
  col.kind,
  col.sort_order,
  count(b.id)::integer as book_count,
  (col.slug = any (public.system_collection_slugs())) as is_system
from public.collections col
left join public.collection_books cb on cb.collection_id = col.id
left join public.books b on b.id = cb.book_id and b.is_published = true
where col.is_published = true
group by col.id;

-- book_count stays "all members" (what the admin curated); published_count is
-- what readers will actually see.
create or replace view public.admin_collection_rows
with (security_invoker = true) as
select
  col.id, col.slug, col.title, col.subtitle, col.accent, col.kind,
  col.sort_order, col.is_published, col.created_at, col.updated_at,
  (select count(*)::int from public.collection_books cb
    where cb.collection_id = col.id) as book_count,
  (select count(*)::int from public.collection_books cb
    join public.books b on b.id = cb.book_id
    where cb.collection_id = col.id and b.is_published = true) as published_count,
  (col.slug = any (public.system_collection_slugs())) as is_system
from public.collections col;

grant select on table public.collection_summaries to anon, authenticated, service_role;
grant select on table public.admin_collection_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. collection_page(): the one read behind home-feed rails and collection-books
-- -----------------------------------------------------------------------------

-- The `collection` meta collection-books has always returned, plus is_system.
create or replace function public.collection_page_meta(c public.collections)
returns jsonb
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'title', c.title,
    'subtitle', c.subtitle,
    'kind', c.kind,
    'sort_order', c.sort_order,
    'is_system', c.slug = any (public.system_collection_slugs())
  );
$fn$;

-- Resolves a published collection by id or slug and returns one page of its
-- books plus the count of the whole list, choosing the list by slug:
--
--   trending      this week's draw, in draw order            source = 'weekly'
--   new-arrivals  curated members when there are any, else
--                 every published book newest-first          source = 'curated' | 'newest'
--   anything else curated members in admin sort_order        source = 'curated'
--
-- Only published books are counted or returned, so a draft still sitting in
-- collection_books neither inflates totalCount nor consumes an offset slot.
-- Returns null for an unknown or unpublished collection; the caller maps that
-- to 404 (collection-books) or an empty rail (home-feed).
--
-- Volatile, not stable, because weekly_trending_books() seeds the week on its
-- first call after Monday and a stable function must not sit above a write.
create or replace function public.collection_page(
  p_id uuid default null,
  p_slug text default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_col public.collections%rowtype;
  v_slug text := nullif(trim(coalesce(p_slug, '')), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_source text;
  v_total integer := 0;
  v_books jsonb := '[]'::jsonb;
begin
  if p_id is null and v_slug is null then
    raise exception 'id or slug is required' using errcode = '22023';
  end if;

  select c.* into v_col
  from public.collections c
  where c.is_published = true
    and ((p_id is not null and c.id = p_id) or (p_id is null and c.slug = v_slug));

  if not found then
    return null;
  end if;

  if v_col.slug = 'trending' then
    v_source := 'weekly';

    -- The draw is at most 50 rows, so page it in memory rather than asking the
    -- RPC for offset support it does not have. Draw order is the rail order.
    select
      count(*)::integer,
      coalesce(
        jsonb_agg((to_jsonb(d) - 'ordinality') order by d.ordinality)
          filter (where d.ordinality > v_offset and d.ordinality <= v_offset + v_limit),
        '[]'::jsonb
      )
    into v_total, v_books
    from public.weekly_trending_books(50) with ordinality as d;

    return jsonb_build_object(
      'collection', public.collection_page_meta(v_col),
      'source', v_source,
      'totalCount', v_total,
      'books', v_books
    );
  end if;

  select count(*)::integer into v_total
  from public.collection_books cb
  join public.books b on b.id = cb.book_id and b.is_published = true
  where cb.collection_id = v_col.id;

  if v_total = 0 and v_col.slug = 'new-arrivals' then
    -- Same order home-feed's `books` list uses, so the rail and the page are
    -- the same list at different lengths.
    v_source := 'newest';

    select count(*)::integer into v_total from public.book_list_items;

    select coalesce(jsonb_agg(to_jsonb(bli) order by bli.published_at desc nulls last, bli.id asc), '[]'::jsonb)
    into v_books
    from (
      select *
      from public.book_list_items
      order by published_at desc nulls last, id asc
      offset v_offset
      limit v_limit
    ) bli;
  else
    v_source := 'curated';

    select coalesce(jsonb_agg(to_jsonb(bli) order by page.sort_order asc, page.book_id asc), '[]'::jsonb)
    into v_books
    from (
      select cb.book_id, cb.sort_order
      from public.collection_books cb
      join public.books b on b.id = cb.book_id and b.is_published = true
      where cb.collection_id = v_col.id
      order by cb.sort_order asc, cb.book_id asc
      offset v_offset
      limit v_limit
    ) page
    join public.book_list_items bli on bli.id = page.book_id;
  end if;

  return jsonb_build_object(
    'collection', public.collection_page_meta(v_col),
    'source', v_source,
    'totalCount', v_total,
    'books', v_books
  );
end;
$fn$;

comment on function public.collection_page(uuid, text, integer, integer) is
  'One page of a published collection''s published books plus totalCount and '
  'source (curated | weekly | newest). Backs collection-books and the home-feed rails.';

revoke all on function public.collection_page(uuid, text, integer, integer) from public;
grant execute on function public.collection_page(uuid, text, integer, integer)
  to anon, authenticated, service_role;

revoke all on function public.collection_page_meta(public.collections) from public;
grant execute on function public.collection_page_meta(public.collections)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Indexes both paged reads lean on. Both exist since 20260726120000; stated
--    here so this migration is the place that promises them.
-- -----------------------------------------------------------------------------

create index if not exists collection_books_sort_idx
  on public.collection_books (collection_id, sort_order);

create index if not exists books_published_idx
  on public.books (is_published, published_at desc)
  where is_published = true;

-- collections_slug_unique has existed since the table was created; make sure
-- of it on a database that was set up by hand.
do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass
      and conname = 'collections_slug_unique'
  ) then
    alter table public.collections
      add constraint collections_slug_unique unique (slug);
  end if;
end;
$do$;

-- -----------------------------------------------------------------------------
-- 6. Retire the two demo collections seed.sql used to plant
-- -----------------------------------------------------------------------------

-- collection_books cascades. Neither slug is a system shelf, so the guard above
-- lets this through; app_settings.featured_collection_id is ON DELETE SET NULL.
delete from public.collections
where slug in ('beginners-path', 'ramadan-reading', 'ramadan-reading-list');
