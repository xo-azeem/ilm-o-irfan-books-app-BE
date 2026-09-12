-- =============================================================================
-- Carousel fallback — five books, drawn at random, fixed for the whole week
-- =============================================================================
-- The carousel is admin-owned (20260908130000_home_carousel.sql), and until an
-- admin puts something on it the app got `[]` and rendered Home with a hole at
-- the top. A brand-new install, or a catalogue whose only campaign just
-- expired, should not look broken.
--
-- So when nothing is live the rail is filled with a weekly draw, built the
-- same way as Trending: the picks are made once, stored, and served to every
-- caller unchanged until Monday 00:00 UTC. The draw is a *fallback*, never a
-- merge — the moment one admin slide is live, the admin's carousel is the whole
-- carousel. An admin who wants the fallback back simply removes their slides.
--
-- Weeks are keyed exactly as trending_weekly is, by current_trending_week(),
-- so the two rails roll over at the same instant and an ops person has one
-- notion of "this week" to reason about.
-- =============================================================================

create table if not exists public.carousel_weekly (
  week_start date not null,
  book_id uuid not null references public.books (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (week_start, book_id)
);

create index if not exists carousel_weekly_week_sort_idx
  on public.carousel_weekly (week_start, sort_order);

-- The picks are the rail the app renders, so they are public knowledge and a
-- plain read policy is enough. Writes only happen inside the SECURITY DEFINER
-- functions below.
alter table public.carousel_weekly enable row level security;

drop policy if exists "carousel_weekly_public_read" on public.carousel_weekly;
create policy "carousel_weekly_public_read"
  on public.carousel_weekly for select
  to anon, authenticated
  using (true);

grant select on table public.carousel_weekly to anon, authenticated;
revoke insert, update, delete on table public.carousel_weekly from anon, authenticated;

-- -----------------------------------------------------------------------------
-- The draw
-- -----------------------------------------------------------------------------

-- Draws a week's fallback picks if they have not been drawn yet, and returns
-- how many rows it inserted (0 when the week was already settled).
--
-- More than five are stored on purpose, for the same reason trending stores
-- thirty: a book unpublished mid-week has to drop out, and without spares the
-- rail would shrink to four until Monday. The reader takes the first five that
-- are still published.
--
-- Books at the front of this week's Trending draw sort to the back of this
-- pool. Trending sits directly under the carousel on Home, and the same five
-- covers appearing twice on one screen reads as a bug, not a coincidence. Only
-- the slice Trending actually shows counts — its pool is thirty deep and would
-- swallow a small catalogue whole — and it is an ordering preference, not an
-- exclusion, so a small catalogue still fills the rail.
create or replace function public.ensure_carousel_week(
  p_week date default null,
  p_pool integer default 15
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_week date := coalesce(p_week, public.current_trending_week());
  v_pool integer := least(greatest(coalesce(p_pool, 15), 1), 200);
  v_inserted integer := 0;
begin
  if exists (select 1 from public.carousel_weekly c where c.week_start = v_week) then
    return 0;
  end if;

  -- Trending has to be settled first, or the de-duplication below has nothing
  -- to de-duplicate against on the first request of the week. Idempotent and
  -- free once the week is drawn.
  perform public.ensure_trending_week(v_week);

  -- Same Monday-morning race as trending: every request in flight finds the
  -- week empty at once, exactly one of them does the draw.
  perform pg_advisory_xact_lock(hashtextextended('carousel_weekly:' || v_week::text, 0));

  if exists (select 1 from public.carousel_weekly c where c.week_start = v_week) then
    return 0;
  end if;

  insert into public.carousel_weekly (week_start, book_id, sort_order)
  select v_week, t.id, t.ord
  from (
    select
      b.id,
      (row_number() over (
        order by
          -- home-feed asks Trending for twelve; anything past that is never on
          -- screen, so it is fair game here.
          exists (
            select 1 from public.trending_weekly t
            where t.week_start = v_week and t.book_id = b.id and t.sort_order < 12
          ),
          random()
      ))::integer - 1 as ord
    from public.books b
    where b.is_published = true
  ) t
  where t.ord < v_pool
  on conflict (week_start, book_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Housekeeping on the once-a-week path, as trending does.
  delete from public.carousel_weekly c
  where c.week_start < v_week - 56;

  return v_inserted;
end;
$fn$;

-- Not granted to anon or authenticated: a client has no business seeding an
-- arbitrary week. home_carousel() below is SECURITY DEFINER and calls it on
-- their behalf for the current week only.
revoke all on function public.ensure_carousel_week(date, integer) from public;
revoke execute on function public.ensure_carousel_week(date, integer) from anon, authenticated;
grant execute on function public.ensure_carousel_week(date, integer) to service_role;

-- -----------------------------------------------------------------------------
-- The rail
-- -----------------------------------------------------------------------------

-- What the app should show in the carousel right now, in one call: the admin's
-- live slides when there are any, otherwise this week's fallback draw.
--
-- `setof carousel_items`, so a fallback slide and an admin slide are the same
-- shape and the app has one renderer. Fallback rows carry `slide_id = null` —
-- that is how a client tells the two apart — and their presentation columns are
-- what an admin slide with no overrides resolves to (headline = title,
-- image_path = cover_path, accent = cover_color), because that is precisely what
-- these are: books on the carousel with nothing written for them.
--
-- SECURITY DEFINER because it seeds the week on first read. That does not widen
-- what a caller can see: carousel_items already filters to active, in-window
-- slides, and book_list_items to is_published, so nothing comes back through
-- here that a plain select on either view would not return.
create or replace function public.home_carousel(
  p_limit integer default 20,
  p_fallback_limit integer default 5
)
returns setof public.carousel_items
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_week date := public.current_trending_week();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_fallback integer := least(greatest(coalesce(p_fallback_limit, 5), 1), 20);
begin
  if exists (select 1 from public.carousel_items) then
    return query
    select ci.*
    from public.carousel_items ci
    order by ci.sort_order nulls first, ci.slide_id
    limit v_limit;
    return;
  end if;

  perform public.ensure_carousel_week(v_week);

  return query
  select
    null::uuid          as slide_id,
    c.sort_order,
    null::text          as badge,
    null::text          as cta_label,
    null::timestamptz   as starts_at,
    null::timestamptz   as ends_at,
    b.title             as headline,
    null::text          as subtitle,
    b.cover_path        as image_path,
    b.cover_color       as accent,
    b.id                as book_id,
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
  from public.carousel_weekly c
  join public.book_list_items b on b.id = c.book_id
  where c.week_start = v_week
  order by c.sort_order
  limit v_fallback;
end;
$fn$;

comment on function public.home_carousel(integer, integer) is
  'The home carousel as the app should render it: admin slides when any are live, '
  'else this week''s five-book fallback draw (slide_id is null on fallback rows).';

revoke all on function public.home_carousel(integer, integer) from public;
grant execute on function public.home_carousel(integer, integer)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admin: re-roll the week
-- -----------------------------------------------------------------------------

-- Same escape hatch as admin_refresh_trending_week. The proper fix for a draw
-- that surfaced the wrong book is to curate the carousel, but a redraw is the
-- thirty-second answer while that is being written.
create or replace function public.admin_refresh_carousel_week(
  p_week date default null,
  p_pool integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_week date := coalesce(p_week, public.current_trending_week());
  v_inserted integer;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  delete from public.carousel_weekly c where c.week_start = v_week;

  v_inserted := public.ensure_carousel_week(v_week, p_pool);

  return jsonb_build_object(
    'weekStart', v_week,
    'picked', v_inserted
  );
end;
$fn$;

revoke all on function public.admin_refresh_carousel_week(date, integer) from public;
revoke execute on function public.admin_refresh_carousel_week(date, integer) from anon;
grant execute on function public.admin_refresh_carousel_week(date, integer)
  to authenticated, service_role;

-- Admin read of the current fallback picks, including any since unpublished,
-- so the CMS can show what the app is falling back to and explain a short rail.
create or replace view public.admin_carousel_fallback_rows
with (security_invoker = true)
as
select
  c.week_start,
  c.sort_order,
  c.book_id,
  b.title,
  b.slug,
  b.cover_path,
  b.is_published,
  b.is_premium,
  a.name as author_name
from public.carousel_weekly c
join public.books b on b.id = c.book_id
join public.authors a on a.id = b.author_id;

grant select on table public.admin_carousel_fallback_rows to authenticated, service_role;
