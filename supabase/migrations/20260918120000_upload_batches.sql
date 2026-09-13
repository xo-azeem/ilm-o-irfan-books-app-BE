-- =============================================================================
-- Bulk uploads: a set of books added one at a time and published together
-- =============================================================================
-- The admin panel adds books one at a time and publishes each on the spot.
-- A series or a new subject arrives as a set, and half a set on Home is worse
-- than none. An upload batch is the smallest thing that holds a set back:
--
--   * `upload_batches` — a name, an optional destination collection and
--     category, and a draft/published status.
--   * `books.upload_batch_id` — nullable; books in a batch are ordinary
--     unpublished rows, invisible to readers through the existing
--     `is_published` filters. Deleting a batch leaves its books as drafts.
--   * `admin_publish_upload_batch()` — puts the batch's books into the
--     destination, then publishes them through `admin_bulk_update_books`, so
--     the storage check that guards every other publish guards this one too.
--     Only a clean run (nothing skipped) marks the batch published and, if
--     the destination collection was hidden, shows it on Home.
--
-- Privileges are opt-in as of 20260913130000: every grant below is explicit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. upload_batches
-- -----------------------------------------------------------------------------

create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft',
  collection_id uuid references public.collections (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  constraint upload_batches_title_not_blank check (length(trim(title)) > 0),
  constraint upload_batches_status_check check (status in ('draft', 'published'))
);

create index if not exists upload_batches_status_created_idx
  on public.upload_batches (status, created_at desc);

drop trigger if exists upload_batches_set_updated_at on public.upload_batches;
create trigger upload_batches_set_updated_at
before update on public.upload_batches
for each row execute function public.set_updated_at();

drop trigger if exists upload_batches_audit on public.upload_batches;
create trigger upload_batches_audit
after insert or update or delete on public.upload_batches
for each row execute function private.audit_write();

alter table public.upload_batches enable row level security;

drop policy if exists "upload_batches_admin_select" on public.upload_batches;
create policy "upload_batches_admin_select"
  on public.upload_batches for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "upload_batches_admin_insert" on public.upload_batches;
create policy "upload_batches_admin_insert"
  on public.upload_batches for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "upload_batches_admin_update" on public.upload_batches;
create policy "upload_batches_admin_update"
  on public.upload_batches for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "upload_batches_admin_delete" on public.upload_batches;
create policy "upload_batches_admin_delete"
  on public.upload_batches for delete
  to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on table public.upload_batches to authenticated;
grant all on table public.upload_batches to service_role;

-- -----------------------------------------------------------------------------
-- 2. books.upload_batch_id
-- -----------------------------------------------------------------------------

alter table public.books
  add column if not exists upload_batch_id uuid
    references public.upload_batches (id) on delete set null;

create index if not exists books_upload_batch_idx
  on public.books (upload_batch_id)
  where upload_batch_id is not null;

-- -----------------------------------------------------------------------------
-- 3. admin_upload_batch_rows — the list screen in one round trip
-- -----------------------------------------------------------------------------

create or replace view public.admin_upload_batch_rows
with (security_invoker = true) as
select
  ub.id,
  ub.title,
  ub.status,
  ub.collection_id,
  ub.category_id,
  c.title as collection_title,
  cat.label as category_label,
  ub.created_by,
  ub.created_at,
  ub.updated_at,
  ub.published_at,
  coalesce(bk.book_count, 0)::int as book_count,
  coalesce(bk.ready_count, 0)::int as ready_count,
  coalesce(bk.published_count, 0)::int as published_count
from public.upload_batches ub
left join public.collections c on c.id = ub.collection_id
left join public.categories cat on cat.id = ub.category_id
left join lateral (
  select
    count(*) as book_count,
    count(*) filter (where b.pdf_path is not null) as ready_count,
    count(*) filter (where b.is_published) as published_count
  from public.books b
  where b.upload_batch_id = ub.id
) bk on true;

grant select on table public.admin_upload_batch_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. admin_book_rows — the batch column, appended so nothing shifts
-- -----------------------------------------------------------------------------

create or replace view public.admin_book_rows
with (security_invoker = true) as
select
  b.id,
  b.slug,
  b.title,
  b.description,
  b.author_id,
  a.name as author_name,
  b.genre,
  b.tag,
  b.tags,
  b.rating,
  b.rating_count,
  b.price_cents,
  b.currency,
  b.format,
  b.cover_path,
  b.cover_color,
  b.cover_color_dark,
  b.pdf_path,
  b.file_size_bytes,
  b.read_time_minutes,
  b.is_premium,
  b.is_published,
  b.published_at,
  b.created_at,
  b.updated_at,
  coalesce(
    (select array_agg(bc.category_id) from public.book_categories bc where bc.book_id = b.id),
    '{}'::uuid[]
  ) as category_ids,
  coalesce(
    (select array_agg(cb.collection_id order by cb.sort_order)
     from public.collection_books cb where cb.book_id = b.id),
    '{}'::uuid[]
  ) as collection_ids,
  (select count(*)::int from public.reading_progress rp where rp.book_id = b.id) as reader_count,
  (select count(*)::int from public.downloads d
    where d.book_id = b.id and d.status = 'completed') as download_count,
  (select count(*)::int from public.wishlist w where w.book_id = b.id) as wishlist_count,
  b.language,
  b.page_count,
  public.book_length_bucket(b.page_count, b.read_time_minutes) as length_bucket,
  b.upload_batch_id
from public.books b
join public.authors a on a.id = b.author_id;

grant select on table public.admin_book_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. admin_publish_upload_batch
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER and called with the caller's own JWT, so is_admin() sees the
-- real user and the audit trigger records them. Membership is written before
-- the publish so a destination chosen after the books were added still gets
-- them; rows already there are left alone (`on conflict do nothing`).

create or replace function public.admin_publish_upload_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.upload_batches%rowtype;
  v_ids uuid[];
  v_result jsonb;
  v_skipped int;
  v_live int;
  v_done boolean := false;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select * into v_batch from public.upload_batches where id = p_batch_id;
  if not found then
    raise exception 'upload batch not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(b.id), '{}'::uuid[])
  into v_ids
  from public.books b
  where b.upload_batch_id = p_batch_id;

  if array_length(v_ids, 1) is null then
    raise exception 'upload batch has no books' using errcode = '22023';
  end if;

  if v_batch.collection_id is not null then
    insert into public.collection_books (collection_id, book_id, sort_order)
    select
      v_batch.collection_id,
      t.id,
      coalesce(
        (select max(cb.sort_order) from public.collection_books cb
          where cb.collection_id = v_batch.collection_id),
        -1
      ) + t.ord
    from unnest(v_ids) with ordinality as t(id, ord)
    on conflict do nothing;
  end if;

  if v_batch.category_id is not null then
    insert into public.book_categories (book_id, category_id)
    select t.id, v_batch.category_id
    from unnest(v_ids) as t(id)
    on conflict do nothing;
  end if;

  v_result := public.admin_bulk_update_books(v_ids, true, null);
  v_skipped := coalesce((v_result ->> 'skipped')::int, 0);

  select count(*)::int into v_live
  from public.books b
  where b.upload_batch_id = p_batch_id and b.is_published;

  -- Published only when every book in the set is live.
  if v_skipped = 0 and v_live = array_length(v_ids, 1) then
    update public.upload_batches
    set status = 'published',
        published_at = coalesce(published_at, timezone('utc', now()))
    where id = p_batch_id;

    if v_batch.collection_id is not null then
      update public.collections
      set is_published = true
      where id = v_batch.collection_id and is_published = false;
    end if;

    v_done := true;
  end if;

  return v_result || jsonb_build_object('batchPublished', v_done);
end;
$$;

revoke all on function public.admin_publish_upload_batch(uuid) from public;
revoke execute on function public.admin_publish_upload_batch(uuid) from anon;
grant execute on function public.admin_publish_upload_batch(uuid) to authenticated, service_role;
