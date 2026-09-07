-- =============================================================================
-- Weekly Trending — ten books, drawn at random, fixed for the whole week
-- =============================================================================
-- random_published_books() re-draws on every call, so two users never saw the
-- same Trending rail and one user saw it change when they pulled to refresh.
-- "Trending this week" has to mean the same ten books for everyone until the
-- week rolls over, so the draw is made once and stored.
--
-- The snapshot also makes the rail cheap: a read is an index lookup of ten
-- rows, not an `order by random()` over the whole catalogue on every request.
--
-- Weeks start Monday 00:00 UTC (date_trunc('week') in Postgres). Everything
-- server-side derives the week from that, so a client's timezone cannot make it
-- disagree with the backend about which week it is.
-- =============================================================================

create table if not exists public.trending_weekly (
  week_start date not null,
  book_id uuid not null references public.books (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (week_start, book_id)
);

create index if not exists trending_weekly_week_sort_idx
  on public.trending_weekly (week_start, sort_order);

-- The picks are public knowledge — they are the rail the app renders — so a
-- plain read policy is enough. Writes only happen inside the SECURITY DEFINER
-- functions below.
alter table public.trending_weekly enable row level security;

drop policy if exists "trending_weekly_public_read" on public.trending_weekly;
create policy "trending_weekly_public_read"
  on public.trending_weekly for select
  to anon, authenticated
  using (true);

grant select on table public.trending_weekly to anon, authenticated;
revoke insert, update, delete on table public.trending_weekly from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Week arithmetic, defined once
-- -----------------------------------------------------------------------------

create or replace function public.current_trending_week()
returns date
language sql
stable
parallel safe
set search_path = public
as $fn$
  select (date_trunc('week', timezone('utc', now())))::date;
$fn$;

comment on function public.current_trending_week() is
  'Monday of the current UTC week. The key trending_weekly is partitioned by.';

grant execute on function public.current_trending_week() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The draw
-- -----------------------------------------------------------------------------

-- Draws a week's picks if they have not been drawn yet, and returns how many
-- rows it inserted (0 when the week was already settled).
--
-- More than ten are stored on purpose. A book that gets unpublished mid-week
-- has to drop out of the rail, and without spare picks the rail would shrink to
-- nine and stay there until Monday. The reader takes the first ten that are
-- still published, so the shortfall is invisible.
create or replace function public.ensure_trending_week(
  p_week date default null,
  p_pool integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_week date := coalesce(p_week, public.current_trending_week());
  v_pool integer := least(greatest(coalesce(p_pool, 30), 1), 200);
  v_inserted integer := 0;
begin
  if exists (select 1 from public.trending_weekly t where t.week_start = v_week) then
    return 0;
  end if;

  -- Monday morning every request in flight finds the week empty at once. The
  -- lock makes exactly one of them do the draw; the rest re-check below and
  -- read what it wrote, rather than each inserting its own sample and leaving
  -- the week with a hundred "picks".
  perform pg_advisory_xact_lock(hashtextextended('trending_weekly:' || v_week::text, 0));

  if exists (select 1 from public.trending_weekly t where t.week_start = v_week) then
    return 0;
  end if;

  insert into public.trending_weekly (week_start, book_id, sort_order)
  select v_week, t.id, t.ord
  from (
    select
      b.id,
      (row_number() over (order by random()))::integer - 1 as ord
    from public.books b
    where b.is_published = true
  ) t
  where t.ord < v_pool
  on conflict (week_start, book_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Housekeeping runs here rather than on a schedule because this is already
  -- the once-a-week code path, and the table has no reason to grow forever.
  delete from public.trending_weekly t
  where t.week_start < v_week - 56;

  return v_inserted;
end;
$fn$;

-- Not granted to anon or authenticated: a client has no business seeding an
-- arbitrary week. weekly_trending_books() below is SECURITY DEFINER and calls
-- it on their behalf for the current week only.
revoke all on function public.ensure_trending_week(date, integer) from public;
revoke execute on function public.ensure_trending_week(date, integer) from anon, authenticated;
grant execute on function public.ensure_trending_week(date, integer) to service_role;

-- The rail itself. `setof book_list_items` so a trending card and a books-list
-- card are the same shape and no field can go missing from one of them.
--
-- SECURITY DEFINER because it seeds the week on first read. That does not widen
-- what a caller can see: book_list_items already filters to is_published, so
-- an unpublished title cannot come back through here.
create or replace function public.weekly_trending_books(p_limit integer default 10)
returns setof public.book_list_items
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_week date := public.current_trending_week();
begin
  perform public.ensure_trending_week(v_week);

  return query
  select b.*
  from public.trending_weekly t
  join public.book_list_items b on b.id = t.book_id
  where t.week_start = v_week
  order by t.sort_order
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$fn$;

comment on function public.weekly_trending_books(integer) is
  'The ten books trending this week. Same set for every caller until Monday UTC.';

revoke all on function public.weekly_trending_books(integer) from public;
grant execute on function public.weekly_trending_books(integer)
  to anon, authenticated, service_role;

-- Week metadata, so the app can show "resets in 2 days" and cache until then
-- without doing calendar maths that has to agree with the server's.
create or replace function public.weekly_trending_meta()
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'weekStart', public.current_trending_week(),
    'weekEnd', public.current_trending_week() + 7,
    'expiresAt', ((public.current_trending_week() + 7)::timestamptz),
    'generatedAt', timezone('utc', now())
  );
$fn$;

revoke all on function public.weekly_trending_meta() from public;
grant execute on function public.weekly_trending_meta() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admin: re-roll the week
-- -----------------------------------------------------------------------------

-- Editorial escape hatch. If the draw surfaced something that should not lead
-- the Home screen, an admin can redraw it rather than waiting for Monday.
create or replace function public.admin_refresh_trending_week(
  p_week date default null,
  p_pool integer default 30
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

  delete from public.trending_weekly t where t.week_start = v_week;

  v_inserted := public.ensure_trending_week(v_week, p_pool);

  return jsonb_build_object(
    'weekStart', v_week,
    'picked', v_inserted
  );
end;
$fn$;

revoke all on function public.admin_refresh_trending_week(date, integer) from public;
revoke execute on function public.admin_refresh_trending_week(date, integer) from anon;
grant execute on function public.admin_refresh_trending_week(date, integer)
  to authenticated, service_role;

-- Admin read of the current picks, including any that have since been
-- unpublished, so the CMS can explain a short rail instead of just showing one.
create or replace view public.admin_trending_rows
with (security_invoker = true)
as
select
  t.week_start,
  t.sort_order,
  t.book_id,
  b.title,
  b.slug,
  b.cover_path,
  b.is_published,
  b.is_premium,
  a.name as author_name
from public.trending_weekly t
join public.books b on b.id = t.book_id
join public.authors a on a.id = b.author_id;

grant select on table public.admin_trending_rows to authenticated, service_role;
