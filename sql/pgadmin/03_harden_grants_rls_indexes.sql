-- =============================================================================
-- Harden grants, RLS initplan, FK indexes, streak insert + cheap daily trigger
-- Additive only: does not rewrite applied schema. Safe to run on existing data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Missing FK index (CASCADE / joins on entitlements.plan_id)
-- Composite uniques on (user_id, book_id) do not help book_id-only lookups.
-- -----------------------------------------------------------------------------

create index if not exists entitlements_plan_id_idx
  on public.entitlements (plan_id);

create index if not exists wishlist_book_id_idx
  on public.wishlist (book_id);

create index if not exists downloads_book_id_idx
  on public.downloads (book_id);

create index if not exists highlights_book_id_idx
  on public.highlights (book_id);

create index if not exists collection_books_book_id_idx
  on public.collection_books (book_id);

-- -----------------------------------------------------------------------------
-- 2. RLS: wrap auth.uid() in (select ...) so Postgres initplans it once
-- Semantics unchanged — same roles, same ownership checks.
-- -----------------------------------------------------------------------------

-- Profiles
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Reading progress
drop policy if exists "reading_progress_select_own" on public.reading_progress;
drop policy if exists "reading_progress_insert_own" on public.reading_progress;
drop policy if exists "reading_progress_update_own" on public.reading_progress;
drop policy if exists "reading_progress_delete_own" on public.reading_progress;

create policy "reading_progress_select_own"
  on public.reading_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "reading_progress_insert_own"
  on public.reading_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "reading_progress_update_own"
  on public.reading_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "reading_progress_delete_own"
  on public.reading_progress for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Wishlist
drop policy if exists "wishlist_select_own" on public.wishlist;
drop policy if exists "wishlist_insert_own" on public.wishlist;
drop policy if exists "wishlist_delete_own" on public.wishlist;

create policy "wishlist_select_own"
  on public.wishlist for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "wishlist_insert_own"
  on public.wishlist for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "wishlist_delete_own"
  on public.wishlist for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Downloads
drop policy if exists "downloads_select_own" on public.downloads;
drop policy if exists "downloads_insert_own" on public.downloads;
drop policy if exists "downloads_update_own" on public.downloads;
drop policy if exists "downloads_delete_own" on public.downloads;

create policy "downloads_select_own"
  on public.downloads for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "downloads_insert_own"
  on public.downloads for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "downloads_update_own"
  on public.downloads for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "downloads_delete_own"
  on public.downloads for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Highlights
drop policy if exists "highlights_select_own" on public.highlights;
drop policy if exists "highlights_insert_own" on public.highlights;
drop policy if exists "highlights_update_own" on public.highlights;
drop policy if exists "highlights_delete_own" on public.highlights;

create policy "highlights_select_own"
  on public.highlights for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "highlights_insert_own"
  on public.highlights for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "highlights_update_own"
  on public.highlights for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "highlights_delete_own"
  on public.highlights for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Reading streaks (add INSERT so a client can create a row if signup trigger missed)
drop policy if exists "reading_streaks_select_own" on public.reading_streaks;
drop policy if exists "reading_streaks_update_own" on public.reading_streaks;
drop policy if exists "reading_streaks_insert_own" on public.reading_streaks;

create policy "reading_streaks_select_own"
  on public.reading_streaks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "reading_streaks_insert_own"
  on public.reading_streaks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "reading_streaks_update_own"
  on public.reading_streaks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Entitlements: still SELECT own only; no client writes
drop policy if exists "entitlements_select_own" on public.entitlements;

create policy "entitlements_select_own"
  on public.entitlements for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 3. Explicit Data API grants (opt-in exposure). RLS still filters rows.
-- Revokes catalog writes from clients — they had no INSERT/UPDATE policies anyway.
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.authors,
  public.books,
  public.categories,
  public.book_categories,
  public.collections,
  public.collection_books,
  public.plans
  to anon, authenticated, service_role;

grant select on table
  public.book_list_items,
  public.category_with_counts,
  public.collection_summaries
  to anon, authenticated, service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.reading_progress to authenticated;
grant select, insert, delete on table public.wishlist to authenticated;
grant select, insert, update, delete on table public.downloads to authenticated;
grant select, insert, update, delete on table public.highlights to authenticated;
grant select, insert, update on table public.reading_streaks to authenticated;
grant select on table public.entitlements to authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.reading_progress,
  public.wishlist,
  public.downloads,
  public.highlights,
  public.reading_streaks,
  public.entitlements
  to service_role;

revoke insert, update, delete on table
  public.authors,
  public.books,
  public.categories,
  public.book_categories,
  public.collections,
  public.collection_books,
  public.plans
  from anon, authenticated;

revoke all on table public.entitlements from anon;
revoke insert, update, delete on table public.entitlements from authenticated;

-- -----------------------------------------------------------------------------
-- 4. Trigger helpers are not a public RPC surface
-- set_updated_at must be SECURITY DEFINER so client writes do not need EXECUTE
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.slugify(text) from public;
revoke all on function public.books_search_vector(text, text, text, text, text[]) from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.user_has_active_premium(uuid) from public;

revoke execute on function public.set_updated_at() from anon, authenticated;
revoke execute on function public.slugify(text) from anon, authenticated;
revoke execute on function public.books_search_vector(text, text, text, text, text[]) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;

grant execute on function public.user_has_active_premium(uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. Streak bump: one PK upsert per progress write; skipped if already today.
-- Private SECURITY DEFINER so authenticated does not need EXECUTE (no RPC).
-- -----------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.touch_reading_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (timezone('utc', now()))::date;
  caller uuid := (select auth.uid());
begin
  if caller is not null and caller is distinct from new.user_id then
    raise exception 'not allowed';
  end if;

  insert into public.reading_streaks as rs (
    user_id,
    current_streak,
    longest_streak,
    last_read_date
  )
  values (new.user_id, 1, 1, today)
  on conflict (user_id) do update
    set
      current_streak = case
        when rs.last_read_date = excluded.last_read_date then rs.current_streak
        when rs.last_read_date = excluded.last_read_date - 1 then rs.current_streak + 1
        else 1
      end,
      longest_streak = greatest(
        rs.longest_streak,
        case
          when rs.last_read_date = excluded.last_read_date then rs.longest_streak
          when rs.last_read_date = excluded.last_read_date - 1 then rs.current_streak + 1
          else 1
        end
      ),
      last_read_date = excluded.last_read_date,
      updated_at = timezone('utc', now())
    where rs.last_read_date is distinct from excluded.last_read_date;

  return new;
end;
$$;

revoke all on function private.touch_reading_streak() from public;
revoke all on function private.touch_reading_streak() from anon, authenticated;

drop trigger if exists reading_progress_touch_streak on public.reading_progress;

create trigger reading_progress_touch_streak
after insert or update of last_read_at, current_page, progress
on public.reading_progress
for each row
execute function private.touch_reading_streak();


-- Follow-up: 20260814120331_harden_function_search_path.sql
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
