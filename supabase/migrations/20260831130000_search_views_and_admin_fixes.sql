-- Forward-only fixes for the endpoint layer.
--
-- Everything here was previously attempted by editing 20260726120000 and
-- 20260826220000 in place. Those files had already been applied, so the
-- migration ledger skipped them and the changes never reached any existing
-- database. This migration re-applies them properly and is safe to run twice.
--
--   1. is_admin() honours profiles.role, matching what the Edge Functions check
--   2. app_settings: PDF paywall closed by default
--   3. books.search_vector becomes trigger-maintained and includes author name
--   4. book_list_items: LEFT JOIN authors, and stop leaking the tsvector
--   5. search_books(): indexed full-text search with a single-scan total count

-- -----------------------------------------------------------------------------
-- 1. is_admin(): JWT app_role OR profiles.role
-- -----------------------------------------------------------------------------
-- The JWT claim is only refreshed when a token is reissued, so a freshly
-- promoted admin failed every is_admin() check until they signed out and back
-- in. The profiles.role fallback closes that window and makes the SQL gate
-- agree with the Edge Function gate.
--
-- The "profiles_admin_select" policy on public.profiles calls this function,
-- so reading profiles here looks like policy recursion. It is not: the
-- function is SECURITY DEFINER and runs as the table owner, and no table in
-- this schema uses FORCE ROW LEVEL SECURITY, so the owner is exempt from RLS.
-- Do NOT add FORCE ROW LEVEL SECURITY to public.profiles without first
-- rewriting this function, or every admin read will fail with 42P17.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
parallel safe
set search_path = public
as $$
  select
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin', false)
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    );
$$;

revoke all on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Close the PDF paywall by default
-- -----------------------------------------------------------------------------
-- Shipping with allow_pdf_without_entitlement = true hands every premium PDF
-- out for free. Dev can re-open it from the admin settings screen.

alter table public.app_settings
  alter column allow_pdf_without_entitlement set default false;

update public.app_settings
set allow_pdf_without_entitlement = false
where id = 1
  and allow_pdf_without_entitlement is true;

-- -----------------------------------------------------------------------------
-- 3. search_vector: trigger-maintained, includes the author name
-- -----------------------------------------------------------------------------
-- author_name lives on a joined table, so a GENERATED column cannot see it.
-- Two triggers keep the document current: one on books, one on authors.name.

create or replace function public.books_search_document(
  p_title text,
  p_description text,
  p_genre text,
  p_tag text,
  p_tags text[],
  p_author_name text
)
returns tsvector
language sql
immutable
parallel safe
as $$
  select
    setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_author_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_description, '')), 'B')
    || setweight(to_tsvector('english', coalesce(p_genre, '')), 'C')
    || setweight(to_tsvector('english', coalesce(p_tag, '')), 'C')
    || setweight(to_tsvector('english', coalesce(array_to_string(p_tags, ' '), '')), 'C');
$$;

-- The view is dropped first: a GENERATED column cannot be dropped while any
-- view references it, and older local databases may have it in the select list.
drop view if exists public.book_list_items;

drop index if exists public.books_search_vector_idx;

alter table public.books drop column if exists search_vector;
alter table public.books add column search_vector tsvector;

create or replace function public.books_refresh_search_vector()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_author_name text;
begin
  select a.name into v_author_name
  from public.authors a
  where a.id = new.author_id;

  new.search_vector := public.books_search_document(
    new.title, new.description, new.genre, new.tag, new.tags, v_author_name
  );

  return new;
end;
$$;

drop trigger if exists books_search_vector_sync on public.books;
create trigger books_search_vector_sync
before insert or update of title, description, genre, tag, tags, author_id
on public.books
for each row execute function public.books_refresh_search_vector();

create or replace function public.authors_refresh_book_search_vectors()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.books b
  set search_vector = public.books_search_document(
    b.title, b.description, b.genre, b.tag, b.tags, new.name
  )
  where b.author_id = new.id;

  return null;
end;
$$;

drop trigger if exists authors_search_vector_sync on public.authors;
create trigger authors_search_vector_sync
after update of name on public.authors
for each row
when (old.name is distinct from new.name)
execute function public.authors_refresh_book_search_vectors();

-- Backfill every existing row through the same helper the triggers use.
update public.books b
set search_vector = public.books_search_document(
  b.title, b.description, b.genre, b.tag, b.tags, a.name
)
from public.authors a
where a.id = b.author_id;

update public.books b
set search_vector = public.books_search_document(
  b.title, b.description, b.genre, b.tag, b.tags, null
)
where b.search_vector is null;

create index books_search_vector_idx on public.books using gin (search_vector);

revoke all on function
  public.books_search_document(text, text, text, text, text[], text) from public;
revoke execute on function
  public.books_search_document(text, text, text, text, text[], text)
  from anon, authenticated;
revoke execute on function public.books_refresh_search_vector() from anon, authenticated;
revoke execute on function public.authors_refresh_book_search_vectors() from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. book_list_items: LEFT JOIN, and no tsvector on the wire
-- -----------------------------------------------------------------------------
-- The INNER JOIN silently dropped any book whose author row was missing.
-- search_vector is deliberately NOT selected: `select('*')` in the Edge
-- Functions would otherwise ship a multi-KB tsvector per row to the phone.

create or replace view public.book_list_items
with (security_invoker = true)
as
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
  b.published_at
from public.books b
left join public.authors a on a.id = b.author_id
where b.is_published = true;

-- The view was dropped above, so the grants from 20260814114738 went with it.
grant select on table public.book_list_items to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. search_books(): one indexed scan, ranked, with a total count
-- -----------------------------------------------------------------------------
-- security invoker keeps the books RLS policy in force, so anon still only
-- ever sees published titles. count(*) over () is evaluated before LIMIT, so
-- the caller gets the full match count without a second query.

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
  with q as (
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
  limit greatest(coalesce(p_limit, 20), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_books(text, integer, integer) from public;
grant execute on function public.search_books(text, integer, integer)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Restore service_role privileges
-- -----------------------------------------------------------------------------
-- 20260814114738 granted only SELECT to service_role on the catalog tables and
-- then revoked writes from anon/authenticated, and the tables added afterwards
-- (app_settings, admin_audit_log) were never granted to service_role at all.
-- The net effect was that service_role - the key the admin Edge Functions use
-- after requireAdmin() - could not read app_settings, could not update books,
-- and could not write the audit log:
--
--   admin-settings  GET/PATCH -> 42501 permission denied for table app_settings
--   admin-book-update PATCH   -> 42501 permission denied for table books
--   get-signed-pdf            -> could not read the paywall flag at all
--
-- service_role bypasses RLS by design and is never handed to a client, so it
-- gets the full set here, matching a stock Supabase project. The hardening
-- that matters - the revokes against anon and authenticated - is untouched.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
