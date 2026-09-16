-- Widen email_outbox kinds for account deletion + Auth template names (Auth
-- letters are sent by the auth-send-email Hook, not the outbox; kinds stay
-- listed so composeEmail and the check stay aligned). Enqueue deletion mail
-- on request / approve / reject. Completion is sent by account-deletion-run
-- before auth.users is removed (outbox rows cascade-delete with profiles).

alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (
  kind in (
    'membership_cancelled',
    'membership_resumed',
    'membership_ended',
    'cancellation_unfinished',
    'membership_activated',
    'account_deletion_requested',
    'account_deletion_approved',
    'account_deletion_rejected',
    'account_deletion_completed',
    'auth_signup',
    'auth_recovery',
    'auth_email_change',
    'auth_magiclink',
    'auth_invite',
    'auth_reauthentication'
  )
);

-- Deduplicate on expiresAt *or* requestId so deletion letters do not collide
-- with empty expiresAt the way membership letters use expiresAt.
create or replace function private.email_enqueue(
  p_user_id uuid,
  p_kind text,
  p_data jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text;
  v_id bigint;
  v_key text;
begin
  select nullif(p.email, '') into v_email
  from public.profiles p
  where p.id = p_user_id;

  if v_email is null then
    return null;
  end if;

  v_key := coalesce(
    nullif(p_data ->> 'requestId', ''),
    nullif(p_data ->> 'expiresAt', ''),
    ''
  );

  if exists (
    select 1
    from public.email_outbox o
    where o.user_id = p_user_id
      and o.kind = p_kind
      and o.status <> 'failed'
      and o.created_at > timezone('utc', now()) - interval '1 hour'
      and coalesce(
        nullif(o.data ->> 'requestId', ''),
        nullif(o.data ->> 'expiresAt', ''),
        ''
      ) = v_key
  ) then
    return null;
  end if;

  insert into public.email_outbox (user_id, to_email, kind, data)
  values (p_user_id, v_email, p_kind, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function private.email_enqueue(uuid, text, jsonb) from public, anon, authenticated;

-- Audit / orphan send: no live profile (or profile about to go). Used when
-- the account is deleted so the outbox row is not cascade-removed.
create or replace function private.email_enqueue_address(
  p_to_email text,
  p_kind text,
  p_data jsonb default '{}'::jsonb,
  p_user_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := nullif(trim(coalesce(p_to_email, '')), '');
  v_id bigint;
begin
  if v_email is null then
    return null;
  end if;

  insert into public.email_outbox (user_id, to_email, kind, data)
  values (p_user_id, v_email, p_kind, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function private.email_enqueue_address(text, text, jsonb, uuid)
  from public, anon, authenticated;

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
  returning id, full_name into v_request_id, v_full_name;

  if not found then
    insert into public.account_deletion_requests (user_id, email, reason, snapshot)
    values (v_uid, auth.jwt() ->> 'email', v_reason, private.account_deletion_snapshot(v_uid))
    returning id into v_request_id;
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

  return public.account_deletion_status();
end;
$$;

comment on function public.request_account_deletion(text) is
  'Files a deletion request for the signed-in reader. Raises SUBSCRIPTION_ACTIVE / BILLING_UNRESOLVED / ADMIN_ACCOUNT / REQUEST_EXISTS with the human message in detail.';

revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated, service_role;

create or replace function public.admin_decide_deletion_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null,
  p_immediate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.account_deletion_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_when timestamptz;
  v_blockers jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select * into v_req from public.account_deletion_requests where id = p_request_id for update;
  if not found then
    raise exception 'deletion request not found' using errcode = 'P0002';
  end if;

  if v_req.status not in ('pending', 'failed') then
    raise exception 'REQUEST_NOT_OPEN'
      using detail = 'This request has already been ' || v_req.status || '.', errcode = 'P0001';
  end if;

  if p_approve then
    v_blockers := private.account_deletion_blockers(v_req.user_id);
    if v_blockers <> '[]'::jsonb then
      raise exception '%', v_blockers -> 0 ->> 'code'
        using detail = v_blockers -> 0 ->> 'message', errcode = 'P0001';
    end if;

    v_when := case when p_immediate then timezone('utc', now())
                   else timezone('utc', now()) + private.account_deletion_grace() end;

    update public.account_deletion_requests
    set status = 'approved',
        decided_at = timezone('utc', now()),
        decided_by = v_actor,
        decision_note = v_note,
        scheduled_for = v_when,
        last_error = null
    where id = p_request_id;
  else
    update public.account_deletion_requests
    set status = 'rejected',
        decided_at = timezone('utc', now()),
        decided_by = v_actor,
        decision_note = v_note,
        scheduled_for = null
    where id = p_request_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, actor_email, action, entity_type, entity_id, entity_label, changes
  )
  values (
    v_actor,
    coalesce(auth.jwt() ->> 'email', 'system'),
    case when p_approve then 'approve' else 'reject' end,
    'account_deletion_request',
    p_request_id::text,
    coalesce(v_req.email, v_req.user_id::text),
    jsonb_build_object(
      'status', jsonb_build_object('from', v_req.status, 'to', case when p_approve then 'approved' else 'rejected' end),
      'scheduledFor', v_when,
      'note', v_note,
      'userId', v_req.user_id
    )
  );

  perform private.push_enqueue(
    case when p_approve then 'account_deletion_approved' else 'account_deletion_rejected' end,
    'users',
    null,
    array[v_req.user_id],
    p_request_id,
    jsonb_build_object(
      'requestId', p_request_id,
      'scheduledFor', v_when,
      'note', v_note
    )
  );

  perform private.email_enqueue(
    v_req.user_id,
    case when p_approve then 'account_deletion_approved' else 'account_deletion_rejected' end,
    jsonb_build_object(
      'userId', v_req.user_id,
      'requestId', p_request_id,
      'fullName', v_req.full_name,
      'scheduledFor', v_when,
      'adminNote', v_note
    )
  );

  select * into v_req from public.account_deletion_requests where id = p_request_id;
  return private.account_deletion_request_json(v_req);
end;
$$;

comment on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) is
  'Admin: approve (schedules the run after the grace period, or now with p_immediate) or reject a pending / failed deletion request. Audited; the reader is notified by push and email.';

revoke all on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) to authenticated, service_role;
