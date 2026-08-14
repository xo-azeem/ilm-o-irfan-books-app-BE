-- Pin search_path on helper SQL functions (advisor: function_search_path_mutable).
-- Switch premium helper to SECURITY INVOKER so it cannot bypass entitlements RLS.

create or replace function public.slugify(input text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.books_search_vector(
  title text,
  description text,
  genre text,
  tag text,
  tags text[]
)
returns tsvector
language sql
immutable
parallel safe
set search_path = public
as $$
  select
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
    || setweight(to_tsvector('english', coalesce(genre, '')), 'C')
    || setweight(to_tsvector('english', coalesce(tag, '')), 'C')
    || setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C');
$$;

create or replace function public.user_has_active_premium(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
parallel safe
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = coalesce((select auth.uid()), p_user_id)
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > timezone('utc', now()))
  );
$$;

revoke all on function public.slugify(text) from public;
revoke all on function public.books_search_vector(text, text, text, text, text[]) from public;
revoke all on function public.user_has_active_premium(uuid) from public;

revoke execute on function public.slugify(text) from anon, authenticated;
revoke execute on function public.books_search_vector(text, text, text, text, text[]) from anon, authenticated;
revoke execute on function public.user_has_active_premium(uuid) from anon;

grant execute on function public.user_has_active_premium(uuid) to authenticated, service_role;
