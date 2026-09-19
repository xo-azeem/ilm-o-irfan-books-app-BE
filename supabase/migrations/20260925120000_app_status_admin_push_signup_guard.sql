-- App status, the admin deletion-request push, and server-side sign-up closing.
--
-- Three things the admin tool's App settings and People → Deletions promise
-- that the database did not yet keep:
--
--   1. `account_deletion_requested` — a push to every admin the moment a
--      reader files a request. Today in the admin tool already lists open
--      requests; this is what makes an admin look before opening it.
--   2. `signup_enabled = false` closes sign-ups for real. The app hides the
--      form, but Google sign-in on the Login screen creates an account for a
--      new address unless Auth is told not to. Two guards, either enough:
--      the Before User Created hook (a clean 403 with a sentence — enable it
--      in Authentication → Hooks on the hosted project) and a BEFORE INSERT
--      trigger on auth.users (always on; Auth reports it as a database error).
--   3. Nothing for `app-status` itself — the Edge Function reads
--      `app_settings` as anon, which already has SELECT by policy.

-- -----------------------------------------------------------------------------
-- 1. Push kind
-- -----------------------------------------------------------------------------

alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'books_published',
  'collection_published',
  'collection_books_added',
  'book_deleted',
  'book_file_replaced',
  'book_updated',
  'membership_activated',
  'membership_expired',
  'account_deletion_approved',
  'account_deletion_rejected',
  'account_deletion_requested'
));

-- Every admin's id, for a push addressed to the people who run the tool.
create or replace function private.admin_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.profiles p
  where p.role = 'admin';
$$;

revoke all on function private.admin_user_ids() from public, anon, authenticated;
grant execute on function private.admin_user_ids() to service_role;

-- Same body as 20260924120000, plus the admin push after the letter to the
-- reader. The request id is the entity, so two requests in the merge window
-- stay two rows (distinct ids) but the dispatcher still folds them per
-- recipient into one tray line with a count.
create or replace function public.request_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blockers jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_request_id uuid;
  v_full_name text;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'REASON_TOO_LONG' using detail = 'Keep the reason under 1000 characters.', errcode = '22023';
  end if;

  if exists (
    select 1 from public.account_deletion_requests r
    where r.user_id = v_uid and r.status in ('pending', 'approved', 'processing', 'failed')
  ) then
    raise exception 'REQUEST_EXISTS' using detail = 'A deletion request is already open for this account.', errcode = '23505';
  end if;

  v_blockers := private.account_deletion_blockers(v_uid);
  if v_blockers <> '[]'::jsonb then
    raise exception '%', v_blockers -> 0 ->> 'code'
      using detail = v_blockers -> 0 ->> 'message', errcode = 'P0001';
  end if;

  insert into public.account_deletion_requests (user_id, email, full_name, reason, snapshot)
  select
    v_uid,
    p.email,
    p.full_name,
    v_reason,
    private.account_deletion_snapshot(v_uid)
  from public.profiles p
  where p.id = v_uid
  returning id, full_name, email into v_request_id, v_full_name, v_email;

  if not found then
    insert into public.account_deletion_requests (user_id, email, reason, snapshot)
    values (v_uid, auth.jwt() ->> 'email', v_reason, private.account_deletion_snapshot(v_uid))
    returning id, email into v_request_id, v_email;
  end if;

  perform private.email_enqueue(
    v_uid,
    'account_deletion_requested',
    jsonb_build_object(
      'userId', v_uid,
      'requestId', v_request_id,
      'fullName', v_full_name
    )
  );

  -- Tell the admins. No admin, or no admin with a device, sends nothing.
  perform private.push_enqueue(
    'account_deletion_requested',
    'users',
    null,
    private.admin_user_ids(),
    v_request_id,
    jsonb_build_object(
      'requestId', v_request_id,
      'fullName', v_full_name,
      'email', v_email
    )
  );

  return public.account_deletion_status();
end;
$$;

comment on function public.request_account_deletion(text) is
  'Files a deletion request for the signed-in reader. Raises SUBSCRIPTION_ACTIVE / BILLING_UNRESOLVED / ADMIN_ACCOUNT / REQUEST_EXISTS with the human message in detail. Emails the reader and pushes every admin.';

revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Sign-ups closed, enforced by the database
-- -----------------------------------------------------------------------------

create or replace function private.signups_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.signup_enabled from public.app_settings s where s.id = 1), true);
$$;

revoke all on function private.signups_open() from public, anon, authenticated;

-- Before User Created hook. Returns `{}` to allow; an error object to refuse
-- with the sentence the app shows. Registered as
-- pg-functions://postgres/private/before_user_created_hook.
create or replace function private.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.signups_open() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign-ups are paused right now. Existing accounts can still sign in.'
    )
  );
end;
$$;

revoke all on function private.before_user_created_hook(jsonb) from public, anon, authenticated;

-- The always-on guard. Auth reports a raised exception here as
-- "Database error saving new user"; the hook above is the one that speaks.
create or replace function private.enforce_signups_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.signups_open() then
    raise exception 'SIGNUPS_CLOSED'
      using detail = 'Sign-ups are paused right now. Existing accounts can still sign in.',
            errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_signups_open() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema private to supabase_auth_admin';
    execute 'grant execute on function private.signups_open() to supabase_auth_admin';
    execute 'grant execute on function private.before_user_created_hook(jsonb) to supabase_auth_admin';
    execute 'grant execute on function private.enforce_signups_open() to supabase_auth_admin';
  end if;
end
$$;

drop trigger if exists on_auth_user_signup_guard on auth.users;
create trigger on_auth_user_signup_guard
before insert on auth.users
for each row execute function private.enforce_signups_open();
