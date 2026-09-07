-- =============================================================================
-- Home carousel — an admin-owned rail, not something the app decides
-- =============================================================================
-- The app used to pick the carousel itself (the first N of whatever list it
-- had). That made the most visible surface in the product the one thing
-- marketing could not change without a store release.
--
-- `collections` was not reused for this. A collection is a shelf of books with
-- one title; a carousel slide is a piece of artwork with its own headline, call
-- to action, accent colour and run dates, that happens to point at a book.
-- Folding the two together would have meant nullable slide columns on every
-- shelf and a `kind = 'carousel'` convention nothing enforced.
--
-- One row per slide, one slide per book. Ordering, activation and scheduling
-- all live here, so "what does the carousel show right now" is answerable by
-- reading one table.
-- =============================================================================

create table if not exists public.carousel_slides (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,

  -- Presentation overrides. All null means "use the book's own metadata",
  -- which is what the carousel_items view falls back to, so an admin can add a
  -- book to the carousel by supplying nothing but its id.
  headline text,
  subtitle text,
  cta_label text,
  badge text,
  image_path text,
  accent text,

  sort_order integer not null default 0,
  is_active boolean not null default true,

  -- Optional run window. A slide outside its window is invisible to the app
  -- but still editable in the CMS, so a campaign can be staged in advance and
  -- expire on its own instead of needing someone to remember to remove it.
  starts_at timestamptz,
  ends_at timestamptz,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint carousel_slides_book_unique unique (book_id),
  constraint carousel_slides_window_check
    check (starts_at is null or ends_at is null or ends_at > starts_at)
);

drop trigger if exists carousel_slides_set_updated_at on public.carousel_slides;
create trigger carousel_slides_set_updated_at
before update on public.carousel_slides
for each row execute function public.set_updated_at();

drop trigger if exists carousel_slides_audit on public.carousel_slides;
create trigger carousel_slides_audit
after insert or update or delete on public.carousel_slides
for each row execute function private.audit_write();

-- The public read is always "active slides in order", so the index carries the
-- predicate rather than making every read filter the whole table.
create index if not exists carousel_slides_active_sort_idx
  on public.carousel_slides (sort_order, id)
  where is_active = true;

create index if not exists carousel_slides_book_idx
  on public.carousel_slides (book_id);

-- -----------------------------------------------------------------------------
-- RLS: the public reads live slides, admins read everything, nobody writes
-- directly. Writes go through the admin_carousel_* RPCs below, so the
-- is_admin() check and the audit trail cannot be skipped by a crafted
-- PostgREST call.
-- -----------------------------------------------------------------------------

alter table public.carousel_slides enable row level security;

drop policy if exists "carousel_public_read_live" on public.carousel_slides;
create policy "carousel_public_read_live"
  on public.carousel_slides for select
  to anon, authenticated
  using (
    is_active = true
    and (starts_at is null or starts_at <= timezone('utc', now()))
    and (ends_at is null or ends_at > timezone('utc', now()))
    -- An unpublished book must not leak through the carousel. This mirrors
    -- books_public_read_published rather than trusting a join to filter.
    and exists (
      select 1 from public.books b
      where b.id = book_id and b.is_published = true
    )
  );

drop policy if exists "carousel_admin_read" on public.carousel_slides;
create policy "carousel_admin_read"
  on public.carousel_slides for select
  to authenticated
  using ((select public.is_admin()));

grant select on table public.carousel_slides to anon, authenticated;
revoke insert, update, delete on table public.carousel_slides from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Public view: one row per live slide, already merged with the book card.
--
-- Every column of book_list_items is carried through, so a slide renders with
-- the same fields as any other book card and the app needs no second fetch to
-- open the book. `headline`, `image_path` and `accent` are already resolved:
-- the admin override when there is one, the book's own value when there is not.
-- -----------------------------------------------------------------------------

create or replace view public.carousel_items
with (security_invoker = true)
as
select
  s.id                                                   as slide_id,
  s.sort_order,
  s.badge,
  s.cta_label,
  s.starts_at,
  s.ends_at,
  coalesce(nullif(trim(s.headline), ''), b.title)        as headline,
  nullif(trim(s.subtitle), '')                           as subtitle,
  coalesce(nullif(trim(s.image_path), ''), b.cover_path) as image_path,
  coalesce(nullif(trim(s.accent), ''), b.cover_color)    as accent,
  b.id                                                   as book_id,
  b.slug,
  b.title,
  b.author_name,
  b.author_id,
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
from public.carousel_slides s
join public.book_list_items b on b.id = s.book_id
where s.is_active = true
  and (s.starts_at is null or s.starts_at <= timezone('utc', now()))
  and (s.ends_at is null or s.ends_at > timezone('utc', now()));

grant select on table public.carousel_items to anon, authenticated, service_role;

comment on view public.carousel_items is
  'Live home carousel: active, in-window slides joined to their published book.';

-- CMS view: every slide, in window or not, with enough of the book to render a
-- management row without a second query.
create or replace view public.admin_carousel_rows
with (security_invoker = true)
as
select
  s.id,
  s.book_id,
  s.headline,
  s.subtitle,
  s.cta_label,
  s.badge,
  s.image_path,
  s.accent,
  s.sort_order,
  s.is_active,
  s.starts_at,
  s.ends_at,
  s.created_at,
  s.updated_at,
  b.title       as book_title,
  b.slug        as book_slug,
  b.cover_path  as book_cover_path,
  b.cover_color as book_cover_color,
  b.is_premium,
  b.is_published,
  a.name        as author_name,
  -- What the app would do with this row right now. Computed here so the CMS
  -- and the app can never disagree about whether a slide is showing.
  (
    s.is_active
    and b.is_published
    and (s.starts_at is null or s.starts_at <= timezone('utc', now()))
    and (s.ends_at is null or s.ends_at > timezone('utc', now()))
  ) as is_live
from public.carousel_slides s
join public.books b on b.id = s.book_id
join public.authors a on a.id = b.author_id;

grant select on table public.admin_carousel_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admin RPCs
-- -----------------------------------------------------------------------------

-- Add a book to the carousel, or edit the slide that is already there.
--
-- Passing null for a presentation field leaves it unchanged on an edit, which
-- is what a partial CMS form sends. '' is the documented way to clear one back
-- to the book's own value, mirroring how profile-update clears a text field.
create or replace function public.admin_carousel_upsert(
  p_id uuid default null,
  p_book_id uuid default null,
  p_headline text default null,
  p_subtitle text default null,
  p_cta_label text default null,
  p_badge text default null,
  p_image_path text default null,
  p_accent text default null,
  p_sort_order integer default null,
  p_is_active boolean default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  -- A null timestamp means "unchanged", the same as every other field here,
  -- which leaves no way to spell "run this slide forever after all". This is
  -- that: it clears both ends of the window in one flag, because a start
  -- without an end and an end without a start are the two states a scheduling
  -- form should never be able to strand a slide in.
  p_clear_schedule boolean default false
)
returns public.carousel_slides
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.carousel_slides;
  v_existing uuid;
  v_next integer;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_id is null then
    if p_book_id is null then
      raise exception 'book_id is required' using errcode = '22023';
    end if;

    if not exists (select 1 from public.books b where b.id = p_book_id) then
      raise exception 'book not found' using errcode = 'P0002';
    end if;

    -- A book already on the carousel is edited rather than rejected: the CMS
    -- "add to carousel" button is the same button whether or not it is there.
    select s.id into v_existing
    from public.carousel_slides s
    where s.book_id = p_book_id;

    if v_existing is not null then
      return public.admin_carousel_upsert(
        v_existing, p_book_id, p_headline, p_subtitle, p_cta_label, p_badge,
        p_image_path, p_accent, p_sort_order, p_is_active, p_starts_at, p_ends_at,
        p_clear_schedule
      );
    end if;

    -- New slides land at the end, so adding one never reshuffles the rail.
    select coalesce(max(s.sort_order) + 1, 0) into v_next from public.carousel_slides s;

    insert into public.carousel_slides (
      book_id, headline, subtitle, cta_label, badge, image_path, accent,
      sort_order, is_active, starts_at, ends_at
    )
    values (
      p_book_id,
      nullif(trim(coalesce(p_headline, '')), ''),
      nullif(trim(coalesce(p_subtitle, '')), ''),
      nullif(trim(coalesce(p_cta_label, '')), ''),
      nullif(trim(coalesce(p_badge, '')), ''),
      nullif(trim(coalesce(p_image_path, '')), ''),
      nullif(trim(coalesce(p_accent, '')), ''),
      coalesce(p_sort_order, v_next),
      coalesce(p_is_active, true),
      case when coalesce(p_clear_schedule, false) then null else p_starts_at end,
      case when coalesce(p_clear_schedule, false) then null else p_ends_at end
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.carousel_slides s
  set
    book_id    = coalesce(p_book_id, s.book_id),
    headline   = case when p_headline   is null then s.headline   else nullif(trim(p_headline), '')   end,
    subtitle   = case when p_subtitle   is null then s.subtitle   else nullif(trim(p_subtitle), '')   end,
    cta_label  = case when p_cta_label  is null then s.cta_label  else nullif(trim(p_cta_label), '')  end,
    badge      = case when p_badge      is null then s.badge      else nullif(trim(p_badge), '')      end,
    image_path = case when p_image_path is null then s.image_path else nullif(trim(p_image_path), '') end,
    accent     = case when p_accent     is null then s.accent     else nullif(trim(p_accent), '')     end,
    sort_order = coalesce(p_sort_order, s.sort_order),
    is_active  = coalesce(p_is_active, s.is_active),
    starts_at  = case when coalesce(p_clear_schedule, false) then null
                      else coalesce(p_starts_at, s.starts_at) end,
    ends_at    = case when coalesce(p_clear_schedule, false) then null
                      else coalesce(p_ends_at, s.ends_at) end
  where s.id = p_id
  returning * into v_row;

  if not found then
    raise exception 'carousel slide not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_carousel_upsert(
  uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz, timestamptz, boolean
) from public;
revoke execute on function public.admin_carousel_upsert(
  uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz, timestamptz, boolean
) from anon;
grant execute on function public.admin_carousel_upsert(
  uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz, timestamptz, boolean
) to authenticated, service_role;

-- Remove slides. Accepts slide ids or book ids in the same array: the CMS list
-- screen holds slide ids and the book editor holds a book id, and neither
-- should have to know which one this function wants.
create or replace function public.admin_carousel_delete(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted integer;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  delete from public.carousel_slides s
  where s.id = any (p_ids) or s.book_id = any (p_ids);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

revoke all on function public.admin_carousel_delete(uuid[]) from public;
revoke execute on function public.admin_carousel_delete(uuid[]) from anon;
grant execute on function public.admin_carousel_delete(uuid[]) to authenticated, service_role;

-- Persist a drag-reorder. Slides not named keep their relative order *after*
-- the ones that are, so reordering the visible page of a long carousel cannot
-- silently renumber the rest of it to 0.
create or replace function public.admin_carousel_reorder(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated integer;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- Push everything else past the named block first, so the two updates cannot
  -- collide on a sort_order in between.
  update public.carousel_slides s
  set sort_order = s.sort_order + array_length(p_ids, 1)
  where not (s.id = any (p_ids));

  update public.carousel_slides s
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$fn$;

revoke all on function public.admin_carousel_reorder(uuid[]) from public;
revoke execute on function public.admin_carousel_reorder(uuid[]) from anon;
grant execute on function public.admin_carousel_reorder(uuid[]) to authenticated, service_role;

-- Replace the whole carousel in one call: the books named become the carousel,
-- in the order given, and anything else is dropped.
--
-- This is what a "manage carousel" screen should save with. Doing it in one
-- statement matters: a client that instead sent delete-all followed by N
-- inserts would leave the app's carousel empty for the width of that round
-- trip. Slides that survive keep their headline and artwork, so re-saving the
-- order does not wipe the copy someone wrote.
create or replace function public.admin_carousel_set(p_book_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_book_ids is not null and exists (
    select 1
    from unnest(p_book_ids) as t(id)
    where not exists (select 1 from public.books b where b.id = t.id)
  ) then
    raise exception 'one or more books do not exist' using errcode = 'P0002';
  end if;

  delete from public.carousel_slides s
  where p_book_ids is null or not (s.book_id = any (p_book_ids));

  if p_book_ids is null or array_length(p_book_ids, 1) is null then
    return 0;
  end if;

  insert into public.carousel_slides (book_id, sort_order)
  select t.id, t.ord - 1
  from unnest(p_book_ids) with ordinality as t(id, ord)
  on conflict (book_id) do update
    set sort_order = excluded.sort_order;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.admin_carousel_set(uuid[]) from public;
revoke execute on function public.admin_carousel_set(uuid[]) from anon;
grant execute on function public.admin_carousel_set(uuid[]) to authenticated, service_role;
