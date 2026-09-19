-- -----------------------------------------------------------------------------
-- Interface language: the reader's preference, and the rails titled in it
-- -----------------------------------------------------------------------------
--
-- 1. profiles.locale — the language the reader chose in Profile → Language,
--    kept on the account so a second device signs in to the same choice.
--    Null means "never chosen": the app falls back to its own default.
-- 2. recommendations_for_me() takes the language the app is showing and
--    titles the "Because you read …" rails in it, falling back to the saved
--    preference, then English. The old three-argument signature is replaced;
--    PostgREST resolves the call with the new default, so the edge function
--    keeps working before it is redeployed.

alter table public.profiles
  add column if not exists locale text;

alter table public.profiles
  drop constraint if exists profiles_locale_check;

alter table public.profiles
  add constraint profiles_locale_check
  check (locale is null or locale in ('en', 'ur'));

comment on column public.profiles.locale is
  'Interface language chosen in the app (en | ur). Null until the reader chooses; synced to every device they sign in on.';

-- profile-update writes it with the caller's JWT, like the other editable
-- columns (see 20260913130000_opt_in_privileges.sql).
grant update (locale) on table public.profiles to authenticated;

drop function if exists public.recommendations_for_me(integer, integer, integer);

create or replace function public.recommendations_for_me(
  p_limit integer default 20,
  p_sections integer default 3,
  p_per_section integer default 10,
  p_locale text default null
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
  -- The language the rails are titled in: what the app is showing right now
  -- (sent with the request) over the reader's saved preference over English.
  v_locale text;
  v_generated timestamptz;
  v_signals timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_locale := coalesce(
    nullif(p_locale, ''),
    (select p.locale from public.profiles p where p.id = v_user),
    'en'
  );
  if v_locale not in ('en', 'ur') then
    v_locale := 'en';
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
        'title', case v_locale
          when 'ur' then 'کیونکہ آپ نے ' || sb.title || ' پڑھی'
          else 'Because you read ' || sb.title
        end,
        'subtitle', case v_locale
          when 'ur' then case s.reason_type
            when 'author' then coalesce(s.reason_label, sb.author_name) || ' کی مزید'
            when 'genre' then 'مزید ' || coalesce(s.reason_label, 'اسی طرح کی')
            when 'category' then coalesce(s.reason_label, 'اسی شیلف') || ' میں مزید'
            when 'tag' then coalesce(s.reason_label, '') || ' ٹیگ کے ساتھ بھی'
            else null
          end
          else case s.reason_type
            when 'author' then 'More from ' || coalesce(s.reason_label, sb.author_name)
            when 'genre' then 'More ' || coalesce(s.reason_label, 'like this')
            when 'category' then 'More in ' || coalesce(s.reason_label, 'this shelf')
            when 'tag' then 'Also tagged ' || coalesce(s.reason_label, '')
            else null
          end
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

comment on function public.recommendations_for_me(integer, integer, integer, text) is
  'Personalised "Because you read ..." rails for auth.uid(), rebuilt on demand when stale, titled in p_locale (en | ur) or the saved profiles.locale.';

revoke all on function public.recommendations_for_me(integer, integer, integer, text) from public;
revoke execute on function public.recommendations_for_me(integer, integer, integer, text) from anon;
grant execute on function public.recommendations_for_me(integer, integer, integer, text)
  to authenticated, service_role;
