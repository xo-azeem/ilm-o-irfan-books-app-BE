-- =============================================================================
-- Category membership, edited from the category
-- =============================================================================
-- Until now a book joined a category only from the book editor, one book at a
-- time (admin_set_book_relations). Curating a category — "put these twelve
-- titles under History" — meant opening twelve books. This adds the mirror of
-- admin_set_collection_books for categories: hand it the full list of books
-- that belong in one category and it makes the junction table match.
--
-- book_categories has no order (Explore sorts a category's books itself), so
-- unlike the collection RPC this one is a plain set operation: rows not in the
-- list go, rows in the list that are missing are added, everything else is
-- left alone. Passing [] empties the category. NULL is treated the same as [].
--
-- The genre-default trigger (private.books_default_category) is unaffected: it
-- only fires on insert/genre change of a book, so removing a book's last
-- category here does not put the genre default straight back.
-- =============================================================================

create or replace function public.admin_set_category_books(
  p_category_id uuid,
  p_book_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_category_id) then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  delete from public.book_categories
  where category_id = p_category_id
    and (p_book_ids is null or not (book_id = any (p_book_ids)));

  if p_book_ids is null or array_length(p_book_ids, 1) is null then
    return;
  end if;

  insert into public.book_categories (book_id, category_id)
  select distinct t.id, p_category_id
  from unnest(p_book_ids) as t(id)
  join public.books b on b.id = t.id
  on conflict (book_id, category_id) do nothing;
end;
$fn$;

comment on function public.admin_set_category_books(uuid, uuid[]) is
  'Admin: replaces the set of books tagged with one category. [] clears it.';

revoke all on function public.admin_set_category_books(uuid, uuid[]) from public;
revoke execute on function public.admin_set_category_books(uuid, uuid[]) from anon;
grant execute on function public.admin_set_category_books(uuid, uuid[])
  to authenticated, service_role;
