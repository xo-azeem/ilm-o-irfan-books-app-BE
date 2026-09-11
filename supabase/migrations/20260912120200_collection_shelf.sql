-- =============================================================================
-- One query per home shelf
--
-- home-feed built each curated shelf (home-hero, new-arrivals) with three
-- sequential round trips from the edge function: find the collection, list its
-- membership, fetch the books. Two shelves ran in parallel with each other but
-- after the first batch, and the trending draw ran after both. Serial depth
-- was five, on the one endpoint every launch hits, and the warm response sat
-- at ~560ms while a single query to the same project takes ~200ms.
--
-- This is the join the function was doing by hand. book_list_items is already
-- restricted to published books, so a draft still sitting in collection_books
-- simply falls out of the shelf rather than needing a second filter.
-- =============================================================================

create or replace function public.collection_shelf(
  p_slug text,
  p_limit integer default 12
)
returns setof public.book_list_items
language sql
stable
set search_path = public
as $fn$
  select bli.*
  from public.collections c
  join public.collection_books cb on cb.collection_id = c.id
  join public.book_list_items bli on bli.id = cb.book_id
  where c.slug = p_slug
    and c.is_published = true
  order by cb.sort_order asc, bli.published_at desc nulls last, bli.id desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$fn$;

comment on function public.collection_shelf(text, integer) is
  'Published books of one published collection, in curated order, in a single '
  'query. Backs the home-feed shelves.';

revoke all on function public.collection_shelf(text, integer) from public;
grant execute on function public.collection_shelf(text, integer) to anon, authenticated, service_role;
