-- =============================================================================
-- "Because you read …" — recommendations derived from what a user actually did
-- =============================================================================
-- The app was guessing: it took a book off the top of some list and captioned
-- it "Because you read X" whether or not X had anything to do with it. This
-- computes the caption instead of asserting it.
--
-- Signals, all of which the app already records:
--
--   reading_progress   how far in, how recently  (the strongest signal)
--   downloads          took it offline
--   wishlist           said "later"
--   highlights         marked passages, i.e. read it closely
--
-- Each signal decays with age, so a genre someone binged last year stops
-- outvoting what they are reading this month. The weighted signals roll up into
-- four affinities — author, genre, category, tag — and candidate books are
-- scored against them. The dimension that contributed most becomes the reason
-- shown to the user, and the highest-weighted book behind that dimension
-- becomes the seed the section is named after.
--
-- Scale: the result is materialised per user in user_recommendations and served
-- from a primary-key read. A rebuild only happens when the user's signals have
-- moved since the last one (and at most every 30 minutes), or once a day
-- regardless. A user who never reads anything is never recomputed; a user
-- turning pages all evening is recomputed twice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Freshness bookkeeping
-- -----------------------------------------------------------------------------

create table if not exists public.user_taste_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Bumped by the triggers below whenever a signal row changes.
  signals_updated_at timestamptz not null default timezone('utc', now()),
  -- Null until the first build.
  recommendations_generated_at timestamptz
);

alter table public.user_taste_state enable row level security;

drop policy if exists "user_taste_state_select_own" on public.user_taste_state;
create policy "user_taste_state_select_own"
  on public.user_taste_state for select
  to authenticated
  using (user_id = auth.uid());

grant select on table public.user_taste_state to authenticated;
revoke insert, update, delete on table public.user_taste_state from anon, authenticated;

create table if not exists public.user_recommendations (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  rank integer not null,
  score numeric(12, 4) not null default 0,
  -- Why this book was picked. 'popular' is the cold-start answer, and the app
  -- uses it to decide whether to caption the rail at all.
  reason_type text not null,
  -- The author name / genre / category label / tag that earned it.
  reason_label text,
  -- The book the user read that led here. Null for 'popular'.
  seed_book_id uuid references public.books (id) on delete set null,
  generated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, book_id),
  constraint user_recommendations_reason_check
    check (reason_type in ('author', 'genre', 'category', 'tag', 'popular')),
  constraint user_recommendations_rank_positive check (rank >= 1)
);

create index if not exists user_recommendations_user_rank_idx
  on public.user_recommendations (user_id, rank);

create index if not exists user_recommendations_seed_idx
  on public.user_recommendations (user_id, seed_book_id)
  where seed_book_id is not null;

alter table public.user_recommendations enable row level security;

drop policy if exists "user_recommendations_select_own" on public.user_recommendations;
create policy "user_recommendations_select_own"
  on public.user_recommendations for select
  to authenticated
  using (user_id = auth.uid());

grant select on table public.user_recommendations to authenticated;
revoke insert, update, delete on table public.user_recommendations from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Signal triggers
--
-- One upsert into a single-row-per-user table, on a primary key. reading_progress
-- is written on every sync from the reader, so this has to stay that cheap — it
-- deliberately records only *that* something changed, never what.
-- -----------------------------------------------------------------------------

create or replace function private.touch_taste_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := new.user_id;
  end if;

  if v_user is null then
    return null;
  end if;

  -- Deleting a profile cascades into every signal table, firing this trigger
  -- once per row *after* the profile is gone. Without this check that insert
  -- would fail the foreign key and take the account deletion down with it.
  if not exists (select 1 from public.profiles p where p.id = v_user) then
    return null;
  end if;

  insert into public.user_taste_state (user_id, signals_updated_at)
  values (v_user, timezone('utc', now()))
  on conflict (user_id) do update
    set signals_updated_at = timezone('utc', now());

  return null;
end;
$fn$;

revoke all on function private.touch_taste_state() from public;
revoke all on function private.touch_taste_state() from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['reading_progress', 'downloads', 'wishlist', 'highlights'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_taste', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function private.touch_taste_state()',
      t || '_touch_taste', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. The build
-- -----------------------------------------------------------------------------

create or replace function public.rebuild_user_recommendations(
  p_user_id uuid,
  p_limit integer default 40
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- More rows are stored than any one screen asks for, so a book going
  -- unpublished shortens the tail rather than punching a hole in the rail.
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_count integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  delete from public.user_recommendations r where r.user_id = p_user_id;

  with signals as (
    select s.book_id, sum(s.weight) as weight
    from (
      -- Depth of reading matters more than the fact of opening it, and a book
      -- read to the end is the clearest statement of taste the app ever gets.
      select
        rp.book_id,
        (0.4 + 1.6 * rp.progress)::double precision
          * exp(-(extract(epoch from (now() - rp.last_read_at))::double precision) / 2592000.0)
      from public.reading_progress rp
      where rp.user_id = p_user_id

      union all

      select
        d.book_id,
        0.7::double precision
          * exp(-(extract(epoch from (now() - d.downloaded_at))::double precision) / 2592000.0)
      from public.downloads d
      where d.user_id = p_user_id and d.status = 'completed'

      union all

      select
        w.book_id,
        0.5::double precision
          * exp(-(extract(epoch from (now() - w.created_at))::double precision) / 2592000.0)
      from public.wishlist w
      where w.user_id = p_user_id

      union all

      -- Highlights are capped: someone who annotates one textbook heavily has
      -- not told us that textbook is four times their whole reading history.
      select h.book_id, least(count(*)::double precision * 0.15, 0.6)
      from public.highlights h
      where h.user_id = p_user_id
      group by h.book_id
    ) s (book_id, weight)
    group by s.book_id
  ),

  -- The books behind the signals, with the metadata the affinities roll up.
  -- Unpublished titles stay in here on purpose: they still say what the user
  -- likes, they just cannot be recommended back.
  sig as (
    select s.book_id, s.weight, b.author_id, b.genre, b.tags
    from signals s
    join public.books b on b.id = s.book_id
  ),

  author_aff as (
    select sb.author_id, sum(sb.weight) as w,
           (array_agg(sb.book_id order by sb.weight desc))[1] as seed_book_id
    from sig sb
    group by sb.author_id
  ),
  genre_aff as (
    select sb.genre, sum(sb.weight) as w,
           (array_agg(sb.book_id order by sb.weight desc))[1] as seed_book_id
    from sig sb
    where sb.genre is not null and length(trim(sb.genre)) > 0
    group by sb.genre
  ),
  tag_aff as (
    select t.tag, sum(sb.weight) as w,
           (array_agg(sb.book_id order by sb.weight desc))[1] as seed_book_id
    from sig sb
    cross join lateral unnest(sb.tags) as t(tag)
    group by t.tag
  ),
  cat_aff as (
    select bc.category_id, sum(sb.weight) as w,
           (array_agg(sb.book_id order by sb.weight desc))[1] as seed_book_id
    from sig sb
    join public.book_categories bc on bc.book_id = sb.book_id
    group by bc.category_id
  ),

  -- Only the strongest few of each dimension go on to select candidates. A
  -- long tail of one-off tags would drag in most of the catalogue and score
  -- all of it near zero.
  top_authors as (select * from author_aff order by w desc limit 12),
  top_genres  as (select * from genre_aff  order by w desc limit 8),
  top_tags    as (select * from tag_aff    order by w desc limit 20),
  top_cats    as (select * from cat_aff    order by w desc limit 10),
  tag_list    as (select coalesce(array_agg(tt.tag), '{}'::text[]) as tags from top_tags tt),

  -- A union of four index-driven lookups rather than one OR over books: an OR
  -- across author_id / genre / tags / category makes the planner give up and
  -- scan the catalogue, which is exactly what this must not do per user.
  candidates as (
    select b.id
    from public.books b
    where b.is_published = true
      and b.author_id in (select ta.author_id from top_authors ta)
    union
    select b.id
    from public.books b
    where b.is_published = true
      and b.genre in (select tg.genre from top_genres tg)
    union
    select b.id
    from public.books b
    where b.is_published = true
      and b.tags && (select tl.tags from tag_list tl)
    union
    select bc.book_id
    from public.book_categories bc
    join public.books b on b.id = bc.book_id
    where b.is_published = true
      and bc.category_id in (select tc.category_id from top_cats tc)
  ),

  scored as (
    select
      b.id as book_id,
      coalesce(aa.w, 0)::double precision * 3.0 as author_score,
      coalesce(ga.w, 0)::double precision * 1.6 as genre_score,
      coalesce(ca.w, 0)::double precision * 1.2 as category_score,
      coalesce(ta.w, 0)::double precision * 0.8 as tag_score,
      -- A small nudge, not a ranking of its own: a 5-star book the user has no
      -- affinity for should still lose to a 3-star book by an author they read.
      (coalesce(b.rating, 0)::double precision / 5.0) * 0.35 as quality_score,
      aa.seed_book_id as author_seed,
      ga.seed_book_id as genre_seed,
      ca.seed_book_id as category_seed,
      ta.seed_book_id as tag_seed,
      au.name as author_name,
      b.genre as book_genre,
      ca.label as category_label,
      ta.tag as tag_label
    from candidates c
    join public.books b on b.id = c.id
    join public.authors au on au.id = b.author_id
    left join top_authors aa on aa.author_id = b.author_id
    left join top_genres ga on ga.genre = b.genre
    left join lateral (
      select
        sum(tt.w) as w,
        (array_agg(tt.seed_book_id order by tt.w desc))[1] as seed_book_id,
        (array_agg(tt.tag order by tt.w desc))[1] as tag
      from top_tags tt
      where tt.tag = any (b.tags)
    ) ta on true
    left join lateral (
      select
        sum(tc.w) as w,
        (array_agg(tc.seed_book_id order by tc.w desc))[1] as seed_book_id,
        (array_agg(cg.label order by tc.w desc))[1] as label
      from top_cats tc
      join public.book_categories bc
        on bc.category_id = tc.category_id and bc.book_id = b.id
      join public.categories cg on cg.id = tc.category_id
    ) ca on true
    -- Never recommend something already read, saved or downloaded.
    where not exists (select 1 from signals s where s.book_id = b.id)
  ),

  ranked as (
    select
      s.*,
      (s.author_score + s.genre_score + s.category_score + s.tag_score + s.quality_score) as total,
      case
        when s.author_score > 0
          and s.author_score >= s.genre_score
          and s.author_score >= s.category_score
          and s.author_score >= s.tag_score then 'author'
        when s.genre_score > 0
          and s.genre_score >= s.category_score
          and s.genre_score >= s.tag_score then 'genre'
        when s.category_score > 0
          and s.category_score >= s.tag_score then 'category'
        when s.tag_score > 0 then 'tag'
        else 'popular'
      end as reason_type
    from scored s
  ),

  final as (
    select
      r.book_id,
      r.total,
      r.reason_type,
      case r.reason_type
        when 'author' then r.author_name
        when 'genre' then r.book_genre
        when 'category' then r.category_label
        when 'tag' then r.tag_label
        else null
      end as reason_label,
      case r.reason_type
        when 'author' then r.author_seed
        when 'genre' then r.genre_seed
        when 'category' then r.category_seed
        when 'tag' then r.tag_seed
        else null
      end as seed_book_id,
      row_number() over (order by r.total desc, r.book_id) as rank_position
    from ranked r
    -- 'popular' here would mean "matched a dimension worth exactly zero",
    -- which is not a recommendation. The cold-start path below owns that word.
    where r.reason_type <> 'popular'
  )

  insert into public.user_recommendations (
    user_id, book_id, rank, score, reason_type, reason_label, seed_book_id, generated_at
  )
  select
    p_user_id,
    f.book_id,
    f.rank_position::integer,
    round(f.total::numeric, 4),
    f.reason_type,
    f.reason_label,
    f.seed_book_id,
    timezone('utc', now())
  from final f
  where f.rank_position <= v_limit;

  get diagnostics v_count = row_count;

  -- Cold start: a brand new account, or one whose entire history is books that
  -- share nothing with the rest of the catalogue. Well rated and recent, with
  -- reason_type 'popular' so the app captions the rail honestly instead of
  -- claiming it knows something it does not.
  if v_count = 0 then
    insert into public.user_recommendations (
      user_id, book_id, rank, score, reason_type, reason_label, seed_book_id, generated_at
    )
    select
      p_user_id,
      f.id,
      f.rank_position::integer,
      round((coalesce(f.rating, 0) / 5.0)::numeric, 4),
      'popular',
      null,
      null,
      timezone('utc', now())
    from (
      select
        b.id,
        b.rating,
        row_number() over (
          order by b.rating desc, b.published_at desc nulls last, b.id
        ) as rank_position
      from public.books b
      where b.is_published = true
        and not exists (
          select 1 from public.reading_progress rp
          where rp.user_id = p_user_id and rp.book_id = b.id
        )
    ) f
    where f.rank_position <= v_limit;

    get diagnostics v_count = row_count;
  end if;

  -- signals_updated_at is only set on insert. Bumping it here would mean the
  -- build we just finished immediately looked stale to itself.
  insert into public.user_taste_state (user_id, signals_updated_at, recommendations_generated_at)
  values (p_user_id, timezone('utc', now()), timezone('utc', now()))
  on conflict (user_id) do update
    set recommendations_generated_at = timezone('utc', now());

  return v_count;
end;
$fn$;

revoke all on function public.rebuild_user_recommendations(uuid, integer) from public;
revoke execute on function public.rebuild_user_recommendations(uuid, integer) from anon, authenticated;
grant execute on function public.rebuild_user_recommendations(uuid, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4. The read
-- -----------------------------------------------------------------------------

-- Returns the caller's recommendations, rebuilding first if they have gone
-- stale. Takes no user id: it reads auth.uid(), so one user cannot ask for
-- another user's taste profile by passing an argument.
create or replace function public.recommendations_for_me(
  p_limit integer default 20,
  p_sections integer default 3,
  p_per_section integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_sections integer := least(greatest(coalesce(p_sections, 3), 0), 6);
  v_per integer := least(greatest(coalesce(p_per_section, 10), 1), 20);
  v_generated timestamptz;
  v_signals timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select s.recommendations_generated_at, s.signals_updated_at
  into v_generated, v_signals
  from public.user_taste_state s
  where s.user_id = v_user;

  -- Never built, a day old, or the user has read something since — but not
  -- more than twice an hour, or a long reading session would rebuild on every
  -- page turn it syncs.
  if v_generated is null
    or v_generated < now() - interval '24 hours'
    or (v_generated < v_signals and v_generated < now() - interval '30 minutes')
  then
    -- Two devices opening Home at once would otherwise each run the build and
    -- fight over the same rows.
    perform pg_advisory_xact_lock(hashtextextended('user_recs:' || v_user::text, 0));

    select s.recommendations_generated_at, s.signals_updated_at
    into v_generated, v_signals
    from public.user_taste_state s
    where s.user_id = v_user;

    if v_generated is null
      or v_generated < now() - interval '24 hours'
      or (v_generated < v_signals and v_generated < now() - interval '30 minutes')
    then
      perform public.rebuild_user_recommendations(v_user);
    end if;
  end if;

  with visible as (
    -- The join to book_list_items is the republish filter: a recommendation
    -- whose book was unpublished since the build simply is not visible.
    select
      r.rank,
      r.reason_type,
      r.reason_label,
      r.seed_book_id,
      r.generated_at,
      to_jsonb(b.*) as card
    from public.user_recommendations r
    join public.book_list_items b on b.id = r.book_id
    where r.user_id = v_user
    order by r.rank
    limit v_limit
  ),
  recs as (
    select
      v.*,
      row_number() over (partition by v.seed_book_id order by v.rank) as seed_rank,
      v.card || jsonb_build_object(
        'reason', jsonb_build_object(
          'type', v.reason_type,
          'label', v.reason_label,
          'seedBookId', v.seed_book_id
        )
      ) as card_with_reason
    from visible v
  ),
  seeded as (
    select
      r.seed_book_id,
      min(r.rank) as best_rank,
      (array_agg(r.reason_type order by r.rank))[1] as reason_type,
      (array_agg(r.reason_label order by r.rank))[1] as reason_label,
      jsonb_agg(r.card_with_reason order by r.rank) as books
    from recs r
    where r.seed_book_id is not null
      and r.seed_rank <= v_per
    group by r.seed_book_id
  ),
  sections as (
    select
      s.best_rank,
      jsonb_build_object(
        'id', 'seed:' || s.seed_book_id::text,
        'seedBookId', s.seed_book_id,
        'reasonType', s.reason_type,
        'reasonLabel', s.reason_label,
        'title', 'Because you read ' || sb.title,
        'subtitle', case s.reason_type
          when 'author' then 'More from ' || coalesce(s.reason_label, sb.author_name)
          when 'genre' then 'More ' || coalesce(s.reason_label, 'like this')
          when 'category' then 'More in ' || coalesce(s.reason_label, 'this shelf')
          when 'tag' then 'Also tagged ' || coalesce(s.reason_label, '')
          else null
        end,
        'seedBook', to_jsonb(sb.*),
        'books', s.books
      ) as section
    from seeded s
    -- Inner join: a section is named after its seed, so a seed that is no
    -- longer in the catalogue has no section to name.
    join public.book_list_items sb on sb.id = s.seed_book_id
    order by s.best_rank
    limit v_sections
  )
  select jsonb_build_object(
    'generatedAt', (select max(r.generated_at) from recs r),
    'isPersonalized', coalesce(
      (select bool_or(r.reason_type <> 'popular') from recs r),
      false
    ),
    'sections', coalesce((select jsonb_agg(x.section order by x.best_rank) from sections x), '[]'::jsonb),
    'books', coalesce(
      (select jsonb_agg(r.card_with_reason order by r.rank) from recs r),
      '[]'::jsonb
    )
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object(
    'generatedAt', null,
    'isPersonalized', false,
    'sections', '[]'::jsonb,
    'books', '[]'::jsonb
  ));
end;
$fn$;

comment on function public.recommendations_for_me(integer, integer, integer) is
  'Personalised "Because you read ..." rails for auth.uid(), rebuilt on demand when stale.';

revoke all on function public.recommendations_for_me(integer, integer, integer) from public;
revoke execute on function public.recommendations_for_me(integer, integer, integer) from anon;
grant execute on function public.recommendations_for_me(integer, integer, integer)
  to authenticated, service_role;
