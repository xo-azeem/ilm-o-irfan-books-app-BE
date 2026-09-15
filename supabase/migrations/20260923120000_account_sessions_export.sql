-- =============================================================================
-- Account self-service: signed-in devices and "download my data"
-- =============================================================================
-- Two things a reader may ask about their own account without an admin:
--
--   * `my_sessions()` / `revoke_session(id)` — the devices currently signed in,
--     read straight from `auth.sessions`, and the power to sign one of them
--     out. Supabase already keeps one session row per sign-in with the device's
--     User-Agent and the time it last refreshed; the app sends a readable
--     User-Agent so the row names the phone. Deleting the row cascades to its
--     refresh tokens, so that device cannot mint another access token; the one
--     it holds lives out its hour. "Sign out everywhere else" is the client's
--     own `signOut({ scope: 'others' })` and needs nothing here.
--
--   * `my_data_export()` — everything the app holds about the reader, as one
--     JSON document, built on demand. Whole rows (`to_jsonb`) so a column added
--     later is exported without a change here; secrets and third-party
--     payloads (a RevenueCat event, an FCM token) are stripped. Rate-limited to
--     one every ten minutes through `data_export_log`, which is also the
--     record that an export happened.
--
-- Password reset and change are Supabase Auth's own (`resetPasswordForEmail`,
-- `reauthenticate` + `updateUser`); nothing here.
--
-- Privileges are opt-in as of 20260913130000: every grant below is explicit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Signed-in devices
-- -----------------------------------------------------------------------------

create or replace function public.my_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'createdAt', s.created_at,
        -- The last time this device minted a token: its "last active".
        'lastActiveAt', coalesce(s.refreshed_at, s.updated_at, s.created_at),
        'userAgent', s.user_agent,
        'ip', s.ip::text,
        'isCurrent', s.id = v_current
      )
      order by (s.id = v_current) desc, coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
    )
    from auth.sessions s
    where s.user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

comment on function public.my_sessions() is
  'The signed-in reader''s sessions from auth.sessions: id, createdAt, lastActiveAt, userAgent, ip, isCurrent. The current one first.';

revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated, service_role;

create or replace function public.revoke_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  -- This device signs itself out through the client, which also clears its
  -- local state; a bare row delete would leave the app thinking it is in.
  if p_session_id = v_current then
    raise exception 'CURRENT_SESSION'
      using detail = 'Use Sign out to end this device''s session.', errcode = 'P0001';
  end if;

  delete from auth.sessions s
  where s.id = p_session_id and s.user_id = v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'SESSION_NOT_FOUND'
      using detail = 'That device is no longer signed in.', errcode = 'P0002';
  end if;

  return public.my_sessions();
end;
$$;

comment on function public.revoke_session(uuid) is
  'Signs one of the reader''s other devices out by deleting its auth.sessions row (refresh tokens cascade). Raises CURRENT_SESSION / SESSION_NOT_FOUND.';

revoke all on function public.revoke_session(uuid) from public, anon;
grant execute on function public.revoke_session(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Download my data
-- -----------------------------------------------------------------------------

create table if not exists public.data_export_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  row_counts jsonb not null default '{}'::jsonb
);

comment on table public.data_export_log is
  'One row per my_data_export() call: the rate limit and the record that a reader took a copy of their data.';

create index if not exists data_export_log_user_idx
  on public.data_export_log (user_id, created_at desc);

alter table public.data_export_log enable row level security;

drop policy if exists "data_export_log_own_select" on public.data_export_log;
create policy "data_export_log_own_select"
  on public.data_export_log for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.data_export_log from public, anon, authenticated;
grant select on table public.data_export_log to authenticated;
grant all on table public.data_export_log to service_role;

create or replace function private.data_export_interval()
returns interval
language sql
immutable
as $$
  select interval '10 minutes';
$$;

-- Rows of one table for one reader, as a JSON array, minus the keys named.
create or replace function private.export_rows(p_sql text, p_uid uuid, p_strip text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(r) - $2), ''[]''::jsonb) from (%s) r',
    p_sql
  ) into v_out using p_uid, p_strip;
  return v_out;
end;
$$;

revoke all on function private.export_rows(text, uuid, text[]) from public, anon, authenticated;

create or replace function public.my_data_export()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_out jsonb;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  select max(l.created_at) into v_last
  from public.data_export_log l
  where l.user_id = v_uid;

  if v_last is not null and v_last > timezone('utc', now()) - private.data_export_interval() then
    raise exception 'EXPORT_RATE_LIMITED'
      using detail = 'You downloaded your data a few minutes ago. Please wait '
        || ceil(extract(epoch from (v_last + private.data_export_interval() - timezone('utc', now()))) / 60)::int
        || ' more minutes.',
      errcode = 'P0001';
  end if;

  v_out := jsonb_build_object(
    'exportedAt', timezone('utc', now()),
    'app', 'Ilm o Irfan',
    'userId', v_uid,
    'account', (
      select jsonb_build_object(
        'email', u.email,
        'emailConfirmedAt', u.email_confirmed_at,
        'createdAt', u.created_at,
        'lastSignInAt', u.last_sign_in_at,
        'providers', coalesce((
          select jsonb_agg(jsonb_build_object('provider', i.provider, 'email', i.identity_data ->> 'email', 'createdAt', i.created_at))
          from auth.identities i where i.user_id = u.id
        ), '[]'::jsonb)
      )
      from auth.users u where u.id = v_uid
    ),
    'profile', (
      select to_jsonb(p) - 'role' from public.profiles p where p.id = v_uid
    ),
    'membership', (
      select to_jsonb(e) - 'raw_event' - 'revenuecat_app_user_id' - 'last_revenuecat_event_id'
      from public.entitlements e where e.user_id = v_uid
    ),
    'readingProgress', private.export_rows(
      'select rp.*, b.title as book_title from public.reading_progress rp left join public.books b on b.id = rp.book_id where rp.user_id = $1',
      v_uid
    ),
    'highlights', private.export_rows(
      'select h.*, b.title as book_title from public.highlights h left join public.books b on b.id = h.book_id where h.user_id = $1',
      v_uid
    ),
    'wishlist', private.export_rows(
      'select w.*, b.title as book_title from public.wishlist w left join public.books b on b.id = w.book_id where w.user_id = $1',
      v_uid
    ),
    'downloads', private.export_rows(
      'select d.*, b.title as book_title from public.downloads d left join public.books b on b.id = d.book_id where d.user_id = $1',
      v_uid
    ),
    'readingDays', private.export_rows(
      'select * from public.reading_days where user_id = $1', v_uid
    ),
    'readingStreak', (
      select to_jsonb(s) from public.reading_streaks s where s.user_id = v_uid
    ),
    'achievements', private.export_rows(
      'select * from public.achievements where user_id = $1', v_uid
    ),
    'notificationDevices', private.export_rows(
      'select * from public.device_push_tokens where user_id = $1', v_uid, array['token']
    ),
    'deletionRequests', private.export_rows(
      'select * from public.account_deletion_requests where user_id = $1', v_uid, array['snapshot']
    ),
    'sessions', public.my_sessions(),
    'previousExports', private.export_rows(
      'select created_at from public.data_export_log where user_id = $1', v_uid
    )
  );

  v_counts := jsonb_build_object(
    'readingProgress', jsonb_array_length(v_out -> 'readingProgress'),
    'highlights', jsonb_array_length(v_out -> 'highlights'),
    'wishlist', jsonb_array_length(v_out -> 'wishlist'),
    'downloads', jsonb_array_length(v_out -> 'downloads')
  );

  insert into public.data_export_log (user_id, row_counts) values (v_uid, v_counts);

  return v_out;
end;
$$;

comment on function public.my_data_export() is
  'Everything held about the signed-in reader as one JSON document: account, profile, membership, reading record, highlights, wishlist, downloads, devices, deletion requests. Rate-limited to one per 10 minutes (EXPORT_RATE_LIMITED); each call is logged in data_export_log.';

revoke all on function public.my_data_export() from public, anon;
grant execute on function public.my_data_export() to authenticated, service_role;
