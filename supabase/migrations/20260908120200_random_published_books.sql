-- =============================================================================
-- random_published_books(): the Trending rail, chosen by the database.
-- =============================================================================
-- Trending is no longer a curated collection. It is a random draw over the
-- whole published catalogue, decided server-side so the app keeps its job of
-- simply listing what it is handed.
--
-- Returns `setof book_list_items`, so a caller gets exactly the same column set
-- as books-list and no field can go missing from a card.
--
-- security invoker (the default) matters: book_list_items is a
-- security_invoker view over books, so the RLS policy still decides what the
-- caller may see. anon therefore draws from published titles only, and this
-- function cannot become a way around that.
--
-- VOLATILE (the default, and correct here) is what keeps random() re-evaluated
-- per call rather than folded to a constant. PostgREST routes volatile RPCs
-- over POST, which is what supabase-js .rpc() issues anyway.

create or replace function public.random_published_books(p_limit integer default 12)
returns setof public.book_list_items
language sql
set search_path = public
as $$
  select *
  from public.book_list_items
  order by random()
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

comment on function public.random_published_books(integer) is
  'Random sample of the published catalogue. Backs the Trending rail in home-feed.';

revoke all on function public.random_published_books(integer) from public;
grant execute on function public.random_published_books(integer)
  to anon, authenticated, service_role;
