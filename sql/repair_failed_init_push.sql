-- One-time cleanup after a failed db push that created authors but not books.
-- Run in Supabase SQL Editor, then: npx supabase db push

drop trigger if exists authors_set_updated_at on public.authors;
drop table if exists public.authors cascade;
drop function if exists public.books_search_vector(text, text, text, text, text[]);
-- keep set_updated_at / slugify / extensions; create or replace handles them
