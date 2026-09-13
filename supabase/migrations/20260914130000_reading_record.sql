-- =============================================================================
-- Reading record: monthly goal, per-day streak history, achievements
-- =============================================================================
-- The Profile screen's "reading record" was mostly synthesised on the device:
-- a hard-coded goal of 4, the all-time finished count standing in for "this
-- month", a sparkline drawn from the streak number, and achievements that
-- could not be computed. This migration makes each of those real, additively:
-- nothing that already exists is renamed or reshaped.
--
--   1. reading_progress.finished_at  — set once, server-side, the first time a
--      row crosses progress >= 0.99. Never overwritten, never cleared.
--   2. profiles.monthly_goal         — the per-user target (1–100, default 4).
--   3. reading_days                  — one row per (user, local day) written by
--      the same trigger that bumps the streak: pages, sync writes, night writes.
--   4. achievements                  — earned state persisted so earned_at is
--      stable and an achievement is never un-earned.
--   5. private.record_reading_activity() replaces private.touch_reading_streak():
--      same trigger event, now timezone-aware, replay-safe, and it also writes
--      3 and 4.
--   6. upsert_reading_progress gains p_tz; public.reading_record(p_tz) is the
--      one read the profile screen needs.
--
-- Timezone rule, used everywhere below: a "day" is the calendar day of the
-- write's last_read_at in the caller's zone. The zone comes from the request
-- (the client_updated_at offset, else the tz field, both resolved by the Edge
-- Function into one string) and reaches the trigger through the
-- transaction-local setting app.reading_tz. A write that arrives with no zone
-- — a direct table write, an old app build — is a UTC day, which is what the
-- old trigger always did.
--
-- Every statement is idempotent. Backfills: finished_at from last_read_at,
-- reading_days from the dates reading_progress already knows, achievements
-- for every existing user.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. reading_progress.finished_at
-- -----------------------------------------------------------------------------

alter table public.reading_progress
  add column if not exists finished_at timestamptz;

comment on column public.reading_progress.finished_at is
  'Server-owned. Set once when progress first reaches 0.99; never overwritten or cleared. Client-supplied values are ignored by the BEFORE trigger.';

-- Rows already past the line finished at the moment of their last read - the
-- best timestamp that exists for them.
update public.reading_progress
set finished_at = last_read_at
where progress >= 0.99
  and finished_at is null;

-- The monthly count and the achievement counts both read "this user's finished
-- rows"; partial so the index only carries finished rows.
create index if not exists reading_progress_user_finished_idx
  on public.reading_progress (user_id, finished_at)
  where finished_at is not null;

-- BEFORE trigger, so the column is owned by the server whatever the grants say:
-- an UPDATE keeps the stored value, an INSERT starts from null, and only the
-- progress threshold can set it. last_read_at is the read that finished the
-- book (the client's own time on a replayed queue entry), capped at now() so a
-- clock a few hours ahead cannot finish a book in next month.
create or replace function private.reading_progress_set_finished_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.finished_at := old.finished_at;
  else
    new.finished_at := null;
  end if;

  if new.finished_at is null and new.progress >= 0.99 then
    new.finished_at := least(coalesce(new.last_read_at, now()), now());
  end if;

  return new;
end;
$$;

revoke all on function private.reading_progress_set_finished_at() from public;
revoke all on function private.reading_progress_set_finished_at() from anon, authenticated;

drop trigger if exists reading_progress_set_finished_at on public.reading_progress;

create trigger reading_progress_set_finished_at
before insert or update on public.reading_progress
for each row
execute function private.reading_progress_set_finished_at();

-- -----------------------------------------------------------------------------
-- 2. profiles.monthly_goal
-- -----------------------------------------------------------------------------
-- On profiles rather than in a side table: the app's table-fallback path reads
-- profiles directly, and a goal is a profile setting. Column-level grant like
-- the other editable profile fields (20260913130000_opt_in_privileges.sql);
-- the CHECK is what enforces the range for a direct write.

alter table public.profiles
  add column if not exists monthly_goal integer not null default 4;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_monthly_goal_range'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_monthly_goal_range check (monthly_goal between 1 and 100);
  end if;
end;
$$;

comment on column public.profiles.monthly_goal is
  'Books the user aims to finish per calendar month (1-100, default 4). Written by reading-goal-update.';

grant update (monthly_goal) on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 3. reading_days
-- -----------------------------------------------------------------------------

create table if not exists public.reading_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  pages_read integer not null default 0,
  sessions integer not null default 0,
  night_sessions integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint reading_days_pages_nonneg check (pages_read >= 0),
  constraint reading_days_sessions_nonneg check (sessions >= 0),
  constraint reading_days_night_sessions_nonneg check (night_sessions >= 0)
);

comment on table public.reading_days is
  'One row per (user, local calendar day) with a reading-progress write. Maintained by private.record_reading_activity(); clients SELECT only.';
comment on column public.reading_days.sessions is
  'Applied reading-progress writes that day (sync bursts, not wall-clock sessions).';
comment on column public.reading_days.pages_read is
  'Sum of max(0, new current_page - old current_page) over that day''s writes.';
comment on column public.reading_days.night_sessions is
  'Writes whose local time was 23:00-03:59. A day with night_sessions > 0 counts toward night-reader.';

alter table public.reading_days enable row level security;

drop policy if exists "reading_days_select_own" on public.reading_days;
create policy "reading_days_select_own"
  on public.reading_days for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.reading_days from anon, authenticated;
grant select on table public.reading_days to authenticated;
grant all on table public.reading_days to service_role;

-- -----------------------------------------------------------------------------
-- 4. achievements
-- -----------------------------------------------------------------------------

create table if not exists public.achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_id),
  constraint achievements_known_id check (
    achievement_id in ('first-book', 'streak-7', 'books-25', 'night-reader')
  )
);

comment on table public.achievements is
  'Earned achievements. A row is written once by private.award_achievements() and never removed; clients SELECT only.';

alter table public.achievements enable row level security;

drop policy if exists "achievements_select_own" on public.achievements;
create policy "achievements_select_own"
  on public.achievements for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.achievements from anon, authenticated;
grant select on table public.achievements to authenticated;
grant all on table public.achievements to service_role;

-- -----------------------------------------------------------------------------
-- 5. Timezone helpers (private; only reachable from the definer functions)
-- -----------------------------------------------------------------------------
-- p_tz is either an IANA name ('Asia/Karachi') or a fixed ISO offset
-- ('+05:00', the form a client_updated_at carries). Anything Postgres cannot
-- resolve is UTC rather than an error: a bad zone must never fail a
-- progress write.

create or replace function private.reading_tz_is_valid(p_tz text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tz is null or p_tz = '' then
    return false;
  end if;

  if p_tz ~ '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$' then
    perform timezone(p_tz::interval, now());
  else
    perform timezone(p_tz, now());
  end if;

  return true;
exception when others then
  return false;
end;
$$;

-- UTC instant -> wall-clock time in the zone.
create or replace function private.reading_local_ts(p_at timestamptz, p_tz text)
returns timestamp
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tz is null or p_tz = '' then
    return timezone('UTC', p_at);
  end if;

  if p_tz ~ '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$' then
    return timezone(p_tz::interval, p_at);
  end if;

  return timezone(p_tz, p_at);
exception when others then
  return timezone('UTC', p_at);
end;
$$;

-- Wall-clock time in the zone -> UTC instant (month boundaries).
create or replace function private.reading_from_local(p_local timestamp, p_tz text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tz is null or p_tz = '' then
    return timezone('UTC', p_local);
  end if;

  if p_tz ~ '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$' then
    return timezone(p_tz::interval, p_local);
  end if;

  return timezone(p_tz, p_local);
exception when others then
  return timezone('UTC', p_local);
end;
$$;

-- The zone the current write was sent with, set by upsert_reading_progress for
-- the life of its transaction. Empty outside the RPC.
create or replace function private.reading_tz()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(current_setting('app.reading_tz', true), '');
$$;

revoke all on function private.reading_tz_is_valid(text) from public, anon, authenticated;
revoke all on function private.reading_local_ts(timestamptz, text) from public, anon, authenticated;
revoke all on function private.reading_from_local(timestamp, text) from public, anon, authenticated;
revoke all on function private.reading_tz() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Achievements: the rules, in one place
-- -----------------------------------------------------------------------------
--   first-book    >= 1  reading_progress rows with finished_at set
--   streak-7      reading_streaks.longest_streak >= 7 (longest, so it stays earned)
--   books-25      >= 25 reading_progress rows with finished_at set
--   night-reader  >= 5  reading_days rows with night_sessions > 0
--
-- earned_at is the moment the data says it happened where that is knowable
-- (the first / 25th finished_at, the streak's last bump) so the backfill does
-- not stamp every existing user with the migration time. Insert-only: a row,
-- once there, is never touched again.

create or replace function private.award_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finished integer := 0;
  v_first_at timestamptz;
  v_25th_at timestamptz;
  v_longest integer := 0;
  v_streak_at timestamptz;
  v_nights integer := 0;
begin
  if p_user_id is null then
    return;
  end if;

  select count(*), min(finished_at)
  into v_finished, v_first_at
  from public.reading_progress
  where user_id = p_user_id and finished_at is not null;

  if v_finished >= 25 then
    select finished_at into v_25th_at
    from public.reading_progress
    where user_id = p_user_id and finished_at is not null
    order by finished_at
    offset 24 limit 1;
  end if;

  select longest_streak, updated_at
  into v_longest, v_streak_at
  from public.reading_streaks
  where user_id = p_user_id;

  select count(*) into v_nights
  from public.reading_days
  where user_id = p_user_id and night_sessions > 0;

  insert into public.achievements (user_id, achievement_id, earned_at)
  select p_user_id, a.id, coalesce(a.at, now())
  from (
    values
      ('first-book',   v_finished >= 1,             v_first_at),
      ('streak-7',     coalesce(v_longest, 0) >= 7, v_streak_at),
      ('books-25',     v_finished >= 25,            v_25th_at),
      ('night-reader', v_nights >= 5,               null::timestamptz)
  ) as a(id, earned, at)
  where a.earned
  on conflict (user_id, achievement_id) do nothing;
end;
$$;

revoke all on function private.award_achievements(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. The write path: streak + reading_days + achievements, one trigger
-- -----------------------------------------------------------------------------
-- Replaces private.touch_reading_streak(). Same trigger event (insert, or
-- update of last_read_at / current_page / progress), three differences:
--
--   day        the local day of new.last_read_at (see the header), not the
--              UTC day of now(). A queue entry replayed the next morning lands
--              on the day it was read.
--   older day  a replayed entry for a day before last_read_date leaves the
--              streak alone instead of resetting it to 1 and moving
--              last_read_date backwards. It still records that reading_day.
--   no-op      an UPDATE that moves nothing forward and carries no new
--              last_read_at (the RPC's one-page clamp write) is not a session.
--
-- Missed-day rule is unchanged: same day -> no change; the day after
-- last_read_date -> current + 1; anything later -> current = 1.
-- longest_streak = greatest(longest, current). current_streak is only ever
-- touched by a read, so it is not zeroed by a missed day until the next read.

create or replace function private.record_reading_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  v_tz text := private.reading_tz();
  v_at timestamptz := least(coalesce(new.last_read_at, now()), now());
  v_local timestamp;
  v_day date;
  v_hour integer;
  v_pages integer;
  v_night integer;
begin
  if caller is not null and caller is distinct from new.user_id then
    raise exception 'not allowed';
  end if;

  if tg_op = 'UPDATE'
     and new.last_read_at is not distinct from old.last_read_at
     and new.progress is not distinct from old.progress
     and new.current_page <= old.current_page then
    return new;
  end if;

  v_local := private.reading_local_ts(v_at, v_tz);
  v_day := v_local::date;
  v_hour := extract(hour from v_local)::integer;
  v_night := case when v_hour >= 23 or v_hour < 4 then 1 else 0 end;
  v_pages := case
    when tg_op = 'INSERT' then greatest(0, new.current_page - 1)
    else greatest(0, new.current_page - old.current_page)
  end;

  insert into public.reading_streaks as rs (
    user_id, current_streak, longest_streak, last_read_date
  )
  values (new.user_id, 1, 1, v_day)
  on conflict (user_id) do update
    set
      current_streak = case
        when rs.last_read_date = v_day - 1 then rs.current_streak + 1
        else 1
      end,
      longest_streak = greatest(
        rs.longest_streak,
        case
          when rs.last_read_date = v_day - 1 then rs.current_streak + 1
          else 1
        end
      ),
      last_read_date = v_day,
      updated_at = now()
    where rs.last_read_date is null
       or rs.last_read_date < v_day;

  insert into public.reading_days as rd (
    user_id, day, pages_read, sessions, night_sessions
  )
  values (new.user_id, v_day, v_pages, 1, v_night)
  on conflict (user_id, day) do update
    set
      pages_read = rd.pages_read + excluded.pages_read,
      sessions = rd.sessions + 1,
      night_sessions = rd.night_sessions + excluded.night_sessions,
      updated_at = now();

  perform private.award_achievements(new.user_id);

  return new;
end;
$$;

revoke all on function private.record_reading_activity() from public, anon, authenticated;

drop trigger if exists reading_progress_touch_streak on public.reading_progress;
drop trigger if exists reading_progress_record_activity on public.reading_progress;

create trigger reading_progress_record_activity
after insert or update of last_read_at, current_page, progress
on public.reading_progress
for each row
execute function private.record_reading_activity();

drop function if exists private.touch_reading_streak();

comment on table public.reading_streaks is
  'Maintained by private.record_reading_activity() on reading_progress writes (local day of last_read_at; UTC when no zone was sent). Clients SELECT only.';

-- -----------------------------------------------------------------------------
-- 8. upsert_reading_progress: carry the zone into the trigger
-- -----------------------------------------------------------------------------
-- Body unchanged apart from the set_config. The six-argument overload is
-- dropped, not kept: PostgREST cannot choose between two overloads that differ
-- only in a defaulted trailing argument (20260914120000).

drop function if exists public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz);

create or replace function public.upsert_reading_progress(
  p_book_id uuid,
  p_current_page integer default null,
  p_total_pages integer default null,
  p_progress numeric default null,
  p_chapter_label text default null,
  p_client_updated_at timestamptz default null,
  p_tz text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.reading_progress;
  v_applied boolean := false;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Transaction-local, so the trigger below sees it and the pooled connection
  -- forgets it at commit. A zone Postgres does not know is treated as UTC by
  -- the trigger; it is never an error here.
  perform set_config('app.reading_tz', coalesce(p_tz, ''), true);

  -- One statement: the conflict row is locked before the WHERE is evaluated,
  -- so two devices syncing at once cannot both think they are newer.
  insert into public.reading_progress as rp (
    user_id, book_id, current_page, total_pages, progress, chapter_label, last_read_at
  )
  values (
    v_uid,
    p_book_id,
    coalesce(p_current_page, 1),
    p_total_pages,
    coalesce(p_progress, 0),
    nullif(p_chapter_label, ''),
    coalesce(p_client_updated_at, timezone('utc', now()))
  )
  on conflict (user_id, book_id) do update
  set
    current_page = coalesce(p_current_page, rp.current_page),
    total_pages = coalesce(p_total_pages, rp.total_pages),
    progress = coalesce(p_progress, rp.progress),
    chapter_label = case
      when p_chapter_label is null then rp.chapter_label
      when p_chapter_label = '' then null
      else p_chapter_label
    end,
    last_read_at = coalesce(p_client_updated_at, timezone('utc', now()))
  where p_client_updated_at is null
     or rp.last_read_at <= p_client_updated_at
  returning * into v_row;

  if found then
    v_applied := true;

    -- Checked on the merged row, not on the request: sending current_page
    -- alone must not be able to push it past a total_pages already stored.
    if v_row.total_pages is not null and v_row.current_page > v_row.total_pages then
      if v_row.current_page = v_row.total_pages + 1 then
        update public.reading_progress
        set current_page = v_row.total_pages
        where id = v_row.id
        returning * into v_row;
      else
        raise exception 'current_page % exceeds total_pages %',
          v_row.current_page, v_row.total_pages
          using errcode = '22023';
      end if;
    end if;
  else
    -- The stored row was newer than the caller's timestamp. Hand it back so
    -- the client can reconcile its cache to what actually won.
    select * into v_row
    from public.reading_progress
    where user_id = v_uid and book_id = p_book_id;
  end if;

  return to_jsonb(v_row) || jsonb_build_object('applied', v_applied);
end;
$$;

comment on function public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz, text) is
  'Partial-merge upsert of the caller''s reading position. With p_client_updated_at the write is last-write-wins against last_read_at; p_tz (IANA name or +HH:MM) sets the calendar day for the streak. Result is the stored row plus applied=true|false.';

revoke all on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz, text) from public;
revoke execute on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz, text) from anon;
grant execute on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. The read: public.reading_record(p_tz)
-- -----------------------------------------------------------------------------
-- Everything the profile screen's reading record needs in one call, scoped to
-- auth.uid(). SECURITY DEFINER so it can use the private zone helpers; every
-- query is filtered by the caller's id and there is no other argument that
-- could name a user.
--
-- p_tz decides "today" and "this month". An unknown zone resolves to UTC and
-- the response's timezone field says which one was used.

create or replace function public.reading_record(p_tz text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_now_local timestamp;
  v_today date;
  v_month_start date;
  v_month_from timestamptz;
  v_month_to timestamptz;
  v_target integer;
  v_completed integer := 0;
  v_finished integer := 0;
  v_nights integer := 0;
  v_streak public.reading_streaks;
  v_recent jsonb;
  v_achievements jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_tz := case when private.reading_tz_is_valid(p_tz) then p_tz else 'UTC' end;
  v_now_local := private.reading_local_ts(now(), v_tz);
  v_today := v_now_local::date;
  v_month_start := date_trunc('month', v_now_local)::date;
  v_month_from := private.reading_from_local(v_month_start::timestamp, v_tz);
  v_month_to := private.reading_from_local((v_month_start + interval '1 month')::timestamp, v_tz);

  select monthly_goal into v_target from public.profiles where id = v_uid;

  select
    count(*),
    count(*) filter (where finished_at >= v_month_from and finished_at < v_month_to)
  into v_finished, v_completed
  from public.reading_progress
  where user_id = v_uid and finished_at is not null;

  select * into v_streak from public.reading_streaks where user_id = v_uid;

  select count(*) into v_nights
  from public.reading_days
  where user_id = v_uid and night_sessions > 0;

  -- Exactly seven entries, oldest first, ending today; a day with no row is
  -- read:false.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'read', rd.user_id is not null and rd.sessions > 0,
      'pages_read', coalesce(rd.pages_read, 0)
    )
    order by d.day
  ), '[]'::jsonb)
  into v_recent
  from generate_series(v_today - 6, v_today, interval '1 day') as g(ts)
  cross join lateral (select g.ts::date as day) as d
  left join public.reading_days rd
    on rd.user_id = v_uid and rd.day = d.day;

  select jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'earned', ach.earned_at is not null,
      'earned_at', ach.earned_at,
      'progress', jsonb_build_object('current', a.current, 'target', a.target)
    )
    order by a.ord
  )
  into v_achievements
  from (
    values
      (1, 'first-book',   v_finished,                            1),
      (2, 'streak-7',     coalesce(v_streak.longest_streak, 0),  7),
      (3, 'books-25',     v_finished,                            25),
      (4, 'night-reader', v_nights,                              5)
  ) as a(ord, id, current, target)
  left join public.achievements ach
    on ach.user_id = v_uid and ach.achievement_id = a.id;

  return jsonb_build_object(
    'readingGoal', jsonb_build_object(
      'target', coalesce(v_target, 4),
      'completedThisMonth', v_completed,
      'month', to_char(v_today, 'YYYY-MM'),
      'timezone', v_tz
    ),
    'streak', jsonb_build_object(
      'current_streak', coalesce(v_streak.current_streak, 0),
      'longest_streak', coalesce(v_streak.longest_streak, 0),
      'last_read_date', v_streak.last_read_date,
      'updated_at', v_streak.updated_at,
      'recent_days', v_recent
    ),
    'achievements', v_achievements
  );
end;
$$;

comment on function public.reading_record(text) is
  'The caller''s reading record: monthly goal, streak with the last seven days, and the four achievements. p_tz (IANA name) sets today and the month; unknown zones resolve to UTC and are echoed as such.';

revoke all on function public.reading_record(text) from public;
revoke execute on function public.reading_record(text) from anon;
grant execute on function public.reading_record(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Backfill existing users
-- -----------------------------------------------------------------------------
-- reading_days: the dates reading_progress already knows about (each row's
-- last_read_at and created_at, plus the streak's last_read_date), as UTC days.
-- Pages and night writes are unknowable for the past, so those stay 0; the
-- rows only say "read on this day". Idempotent: existing rows are left alone.

insert into public.reading_days (user_id, day, pages_read, sessions, night_sessions)
select distinct d.user_id, d.day, 0, 1, 0
from (
  select rp.user_id, (timezone('UTC', rp.last_read_at))::date as day
  from public.reading_progress rp
  union
  select rp.user_id, (timezone('UTC', rp.created_at))::date
  from public.reading_progress rp
  union
  select rs.user_id, rs.last_read_date
  from public.reading_streaks rs
  where rs.last_read_date is not null
) as d
where d.day is not null
on conflict (user_id, day) do nothing;

do $$
begin
  perform private.award_achievements(p.id) from public.profiles p;
end;
$$;
