-- =============================================================================
-- Trending this week — the admin's list first, the weekly draw as the stand-in
-- =============================================================================
-- collection_page('trending') served the server's random weekly draw and
-- nothing else: an admin who put books on the Trending shelf in the CMS had
-- them written to collection_books and then ignored. The shelf now works the
-- way New arrivals does — the curated members when there are any, in the
-- admin's order and however many there are; the weekly draw only when the
-- admin has curated nothing.
--
-- home-feed and collection-books both read through collection_page(), so a
-- change in the CMS reaches the rail and its "See all" page together, within
-- the endpoints' one-minute cache. The weekly draw itself (trending_weekly,
-- weekly_trending_books, admin-refresh-trending) is untouched: it is still
-- what the rail shows until an admin chooses, and what trending-weekly serves.
-- =============================================================================

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

  -- Only published members count, for every collection: a draft still sitting
  -- in collection_books neither inflates totalCount nor consumes an offset.
  select count(*)::integer into v_total
  from public.collection_books cb
  join public.books b on b.id = cb.book_id and b.is_published = true
  where cb.collection_id = v_col.id;

  if v_total = 0 and v_col.slug = 'trending' then
    -- Nothing curated: this week's draw, in draw order. At most 50 rows, so
    -- it is paged in memory rather than asking the RPC for offset support.
    v_source := 'weekly';

    select
      count(*)::integer,
      coalesce(
        jsonb_agg((to_jsonb(d) - 'ordinality') order by d.ordinality)
          filter (where d.ordinality > v_offset and d.ordinality <= v_offset + v_limit),
        '[]'::jsonb
      )
    into v_total, v_books
    from public.weekly_trending_books(50) with ordinality as d;

  elsif v_total = 0 and v_col.slug = 'new-arrivals' then
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
    -- The admin's list, in the admin's order — for Trending and New arrivals
    -- exactly as for any other collection.
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
  'source (curated | weekly | newest). Trending and New arrivals serve their '
  'curated members when there are any, else the weekly draw / the newest books. '
  'Backs collection-books and the home-feed rails.';

revoke all on function public.collection_page(uuid, text, integer, integer) from public;
grant execute on function public.collection_page(uuid, text, integer, integer)
  to anon, authenticated, service_role;
