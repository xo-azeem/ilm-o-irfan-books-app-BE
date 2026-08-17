-- =============================================================================
-- App roles (user | admin), admin CMS RLS, JWT claim sync, dashboard RPCs
-- Additive only. Guest vs subscriber remain derived (anon session / entitlements).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles.role
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end;
$$;

create index if not exists profiles_role_admin_idx
  on public.profiles (id)
  where role = 'admin';

create index if not exists entitlements_active_user_idx
  on public.entitlements (user_id)
  where status = 'active';

-- New signups stay 'user'. Never overwrite an existing role on conflict.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    'user'
  )
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      phone = coalesce(excluded.phone, public.profiles.phone),
      updated_at = timezone('utc', now());

  insert into public.reading_streaks (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. JWT app_metadata.app_role sync + is_admin()
-- -----------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.sync_app_role_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users
  set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('app_role', new.role)
  where id = new.id;

  return new;
end;
$$;

revoke all on function private.sync_app_role_claim() from public;
revoke all on function private.sync_app_role_claim() from anon, authenticated;

drop trigger if exists profiles_sync_app_role_claim on public.profiles;

create trigger profiles_sync_app_role_claim
after insert or update of role
on public.profiles
for each row
execute function private.sync_app_role_claim();

-- Backfill JWT claims for existing profiles.
update auth.users u
set raw_app_meta_data =
  coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('app_role', p.role)
from public.profiles p
where p.id = u.id;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
parallel safe
set search_path = public
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin',
    false
  );
$$;

revoke all on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. admin_set_user_role (column-level lock on profiles.role)
-- -----------------------------------------------------------------------------

create or replace function public.admin_set_user_role(target_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
  admin_count integer;
begin
  if new_role not in ('user', 'admin') then
    raise exception 'invalid role';
  end if;

  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select p.role into current_role
  from public.profiles p
  where p.id = target_id;

  if current_role is null then
    raise exception 'user not found';
  end if;

  if current_role = 'admin' and new_role = 'user' then
    select count(*) into admin_count
    from public.profiles
    where role = 'admin';

    if admin_count <= 1 then
      raise exception 'cannot demote the last admin';
    end if;
  end if;

  update public.profiles
  set role = new_role
  where id = target_id;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
revoke execute on function public.admin_set_user_role(uuid, text) from anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated, service_role;

-- Authenticated users may update contact fields only — never role.
revoke update on table public.profiles from authenticated;
grant update (
  full_name,
  email,
  phone,
  avatar_path,
  date_of_birth,
  address_line1,
  address_line2,
  city,
  state,
  postal_code,
  country
) on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Admin dashboard stats (single round-trip)
-- -----------------------------------------------------------------------------

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'user_count', (select count(*)::int from public.profiles),
    'admin_count', (select count(*)::int from public.profiles where role = 'admin'),
    'subscriber_count', (
      select count(*)::int
      from public.entitlements e
      where e.status = 'active'
        and (e.expires_at is null or e.expires_at > timezone('utc', now()))
    ),
    'guest_signed_in_count', (
      select count(*)::int
      from public.profiles p
      where p.role is distinct from 'admin'
        and not exists (
          select 1
          from public.entitlements e
          where e.user_id = p.id
            and e.status = 'active'
            and (e.expires_at is null or e.expires_at > timezone('utc', now()))
        )
    ),
    'book_published_count', (select count(*)::int from public.books where is_published),
    'book_draft_count', (select count(*)::int from public.books where not is_published),
    'author_count', (select count(*)::int from public.authors),
    'download_completed_count', (
      select count(*)::int from public.downloads where status = 'completed'
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
revoke execute on function public.admin_dashboard_stats() from anon;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Admin directory view (no entitlements.raw_event)
-- -----------------------------------------------------------------------------

create or replace view public.admin_user_directory
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  p.email,
  p.role,
  p.created_at,
  e.status as entitlement_status,
  e.expires_at,
  e.store,
  pl.name as plan_name
from public.profiles p
left join public.entitlements e on e.user_id = p.id
left join public.plans pl on pl.id = e.plan_id;

grant select on table public.admin_user_directory to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. RLS: admin catalog CMS + directory reads
-- -----------------------------------------------------------------------------

-- Unpublished catalog (OR'd with existing published-only policies)
create policy "books_admin_read_all"
  on public.books for select
  to authenticated
  using ((select public.is_admin()));

create policy "collections_admin_read_all"
  on public.collections for select
  to authenticated
  using ((select public.is_admin()));

create policy "book_categories_admin_read_all"
  on public.book_categories for select
  to authenticated
  using ((select public.is_admin()));

create policy "collection_books_admin_read_all"
  on public.collection_books for select
  to authenticated
  using ((select public.is_admin()));

create policy "plans_admin_read_all"
  on public.plans for select
  to authenticated
  using ((select public.is_admin()));

create policy "profiles_admin_select"
  on public.profiles for select
  to authenticated
  using ((select public.is_admin()));

create policy "entitlements_admin_select"
  on public.entitlements for select
  to authenticated
  using ((select public.is_admin()));

-- Catalog writes: admin JWT only
create policy "authors_admin_write"
  on public.authors for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "books_admin_write"
  on public.books for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "books_admin_update"
  on public.books for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "books_admin_delete"
  on public.books for delete
  to authenticated
  using ((select public.is_admin()));

create policy "categories_admin_write"
  on public.categories for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "book_categories_admin_write"
  on public.book_categories for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "collections_admin_write"
  on public.collections for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "collections_admin_update"
  on public.collections for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "collections_admin_delete"
  on public.collections for delete
  to authenticated
  using ((select public.is_admin()));

create policy "collection_books_admin_write"
  on public.collection_books for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant insert, update, delete on table
  public.authors,
  public.books,
  public.categories,
  public.book_categories,
  public.collections,
  public.collection_books
  to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Storage: admin writes to covers + pdfs (pdfs stay private / no client SELECT)
-- -----------------------------------------------------------------------------

create policy "covers_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'covers'
    and (select public.is_admin())
  );

create policy "covers_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'covers'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'covers'
    and (select public.is_admin())
  );

create policy "covers_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'covers'
    and (select public.is_admin())
  );

create policy "pdfs_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pdfs'
    and (select public.is_admin())
  );

create policy "pdfs_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pdfs'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'pdfs'
    and (select public.is_admin())
  );

create policy "pdfs_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pdfs'
    and (select public.is_admin())
  );
