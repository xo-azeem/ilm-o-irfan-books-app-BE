-- =============================================================================
-- Account deletion: a reader's request, an admin's decision, a grace period,
-- and an executor that removes the auth user.
-- =============================================================================
-- Both stores require deletion to be reachable in-app. It is not required to
-- be instant, and here it deliberately is not: an account holds a paid
-- membership, downloads and a reading record, and a wrong tap or a stolen
-- session must not erase them on the spot. The flow is
--
--   request  ─►  pending  ─►  approved (scheduled_for = now + grace)  ─►  completed
--                  │              │                    ▲
--                  ├─► rejected   ├─► cancelled        └─ failed (blocked at run
--                  └─► cancelled  └─► processing ─►         time; admin retries)
--
--   * `account_deletion_requests` — one open row per reader (partial unique
--     index). `user_id` has no foreign key on purpose: the row is the record
--     that the deletion happened, and must outlive the account.
--   * `account_deletion_status()` — what the reader sees: their latest request,
--     whether they may file a new one, and why not (blockers) or what they
--     should know first (warnings).
--   * `request_account_deletion(reason)` / `cancel_account_deletion_request()`
--     — the reader's two moves. Cancelling is allowed right up to execution.
--   * `admin_deletion_requests(status)` / `admin_decide_deletion_request(...)`
--     — the admin's list and decision. Approval schedules the run after the
--     grace period; `p_immediate` skips it. Every decision is audited and
--     pushed to the reader.
--   * `public.account_deletion_claim()` / `public.account_deletion_mark()` —
--     the executor's half. The `account-deletion-run` Edge Function claims due
--     rows, re-checks the blockers, removes the reader's storage objects and
--     the auth user, and marks the row. A pg_cron tick kicks it through pg_net
--     (`private.account_deletion_kick`, secret in `private.runtime_config`);
--     an admin can also press "Run now".
--
-- Billing edge cases, decided here and nowhere else:
--
--   * An auto-renewing store subscription (`active` / `trial`, or the store
--     still retrying in `grace` / `billing_issue`) BLOCKS the request. We
--     cannot cancel a store subscription on the reader's behalf, and deleting
--     the account would leave them billed for an app they can no longer open.
--     They cancel in the App Store / Play first; the request goes through once
--     the entitlement reads `cancelled` (or `expired`).
--   * A `cancelled` membership that is still paid through is ALLOWED, with a
--     warning that the remaining time is forfeited and refunds are the store's.
--   * A promotional / comped entitlement never blocks — nobody is being billed.
--   * The last admin, or any admin, is blocked: demote first.
--   * The blockers are re-evaluated by the executor at run time. A membership
--     bought during the grace period parks the row as `failed` with the code,
--     for an admin to retry or reject.
--
-- Privileges are opt-in as of 20260913130000: every grant below is explicit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. account_deletion_requests
-- -----------------------------------------------------------------------------

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- No FK: this row must survive the account it is about.
  user_id uuid not null,
  email text,
  full_name text,
  reason text,
  status text not null default 'pending',
  requested_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text,
  -- Approved rows may run from this instant on.
  scheduled_for timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  -- The entitlement as it stood when the reader asked, for the admin's context.
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint account_deletion_requests_status_check check (
    status in ('pending', 'approved', 'processing', 'completed', 'failed', 'rejected', 'cancelled')
  ),
  constraint account_deletion_requests_reason_length check (
    reason is null or length(reason) <= 1000
  ),
  constraint account_deletion_requests_note_length check (
    decision_note is null or length(decision_note) <= 1000
  )
);

comment on table public.account_deletion_requests is
  'A reader''s request to delete their account, the admin''s decision, and the executor''s outcome. user_id is deliberately not a foreign key: the row outlives the account.';

-- One open request per reader. `failed` is open too: it is an approved
-- request the executor could not run (a membership bought during the grace
-- period), and the reader may still withdraw it.
create unique index if not exists account_deletion_requests_open_idx
  on public.account_deletion_requests (user_id)
  where status in ('pending', 'approved', 'processing', 'failed');

create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests (status, requested_at desc);

create index if not exists account_deletion_requests_due_idx
  on public.account_deletion_requests (scheduled_for)
  where status = 'approved';

create index if not exists account_deletion_requests_user_idx
  on public.account_deletion_requests (user_id, requested_at desc);

drop trigger if exists account_deletion_requests_set_updated_at on public.account_deletion_requests;
create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;

-- Readers see their own rows; admins see all. Every write goes through an RPC.
drop policy if exists "account_deletion_requests_own_select" on public.account_deletion_requests;
create policy "account_deletion_requests_own_select"
  on public.account_deletion_requests for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select on table public.account_deletion_requests to authenticated;
grant all on table public.account_deletion_requests to service_role;

-- -----------------------------------------------------------------------------
-- 2. Push kinds for the decision
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
  'account_deletion_rejected'
));

-- -----------------------------------------------------------------------------
-- 3. Policy: grace period, blockers, warnings
-- -----------------------------------------------------------------------------

create or replace function private.account_deletion_grace()
returns interval
language sql
immutable
as $$
  select interval '7 days';
$$;

comment on function private.account_deletion_grace() is
  'How long an approved deletion waits before it runs. The reader may cancel until it does.';

-- Why this reader may not file (or run) a deletion right now. Empty = free to go.
-- Each entry is { code, message, ... } and the codes are the FE's contract.
create or replace function private.account_deletion_blockers(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_expires timestamptz;
  v_store text;
  v_now timestamptz := timezone('utc', now());
  v_out jsonb := '[]'::jsonb;
begin
  select p.role into v_role from public.profiles p where p.id = p_user_id;

  if v_role = 'admin' then
    v_out := v_out || jsonb_build_object(
      'code', 'ADMIN_ACCOUNT',
      'message', 'Admin accounts cannot be deleted. Ask another admin to change your role to reader first.'
    );
  end if;

  select e.status, e.expires_at, e.store
  into v_status, v_expires, v_store
  from public.entitlements e
  where e.user_id = p_user_id;

  -- A promotional comp bills nobody, so it never blocks. Anything else that
  -- is still renewing, or that the store is still trying to charge, does.
  if v_status is not null and coalesce(v_store, 'promotional') <> 'promotional' then
    if v_status in ('active', 'trial') and (v_expires is null or v_expires > v_now) then
      v_out := v_out || jsonb_build_object(
        'code', 'SUBSCRIPTION_ACTIVE',
        'message', 'Your membership still renews automatically. Cancel it in the App Store or Play Store first — deleting your account does not stop the store from billing you.',
        'store', v_store,
        'expiresAt', v_expires
      );
    elsif v_status in ('grace', 'billing_issue') then
      v_out := v_out || jsonb_build_object(
        'code', 'BILLING_UNRESOLVED',
        'message', 'The store is still trying to bill your membership. Cancel it in the App Store or Play Store, or fix the payment, and try again once it shows as cancelled.',
        'store', v_store,
        'expiresAt', v_expires
      );
    end if;
  end if;

  return v_out;
end;
$$;

revoke all on function private.account_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function private.account_deletion_blockers(uuid) to service_role;

-- Things worth saying before the reader confirms. None of these stop the request.
create or replace function private.account_deletion_warnings(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_expires timestamptz;
  v_store text;
  v_now timestamptz := timezone('utc', now());
  v_downloads integer;
  v_out jsonb := '[]'::jsonb;
begin
  select e.status, e.expires_at, e.store
  into v_status, v_expires, v_store
  from public.entitlements e
  where e.user_id = p_user_id;

  if v_status = 'cancelled' and v_expires is not null and v_expires > v_now then
    v_out := v_out || jsonb_build_object(
      'code', 'PAID_TIME_FORFEITED',
      'message', 'Your membership is paid through ' || to_char(v_expires, 'DD Mon YYYY') || '. Deleting now gives up the time left; refunds are handled by the store, not by us.',
      'expiresAt', v_expires
    );
  elsif v_status in ('active', 'trial') and coalesce(v_store, 'promotional') = 'promotional'
    and (v_expires is null or v_expires > v_now) then
    v_out := v_out || jsonb_build_object(
      'code', 'COMP_ACCESS_LOST',
      'message', 'Your complimentary membership ends with the account and cannot be restored.',
      'expiresAt', v_expires
    );
  end if;

  select count(*)::int into v_downloads
  from public.downloads d
  where d.user_id = p_user_id and d.status <> 'failed';

  if v_downloads > 0 then
    v_out := v_out || jsonb_build_object(
      'code', 'DOWNLOADS_REMOVED',
      'message', 'Books downloaded to your devices will no longer open once the account is deleted.',
      'count', v_downloads
    );
  end if;

  return v_out;
end;
$$;

revoke all on function private.account_deletion_warnings(uuid) from public, anon, authenticated;
grant execute on function private.account_deletion_warnings(uuid) to service_role;

-- The entitlement as the admin will want to see it beside the request.
create or replace function private.account_deletion_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'entitlementStatus', e.status,
        'expiresAt', e.expires_at,
        'store', e.store,
        'planName', pl.name
      )
      from public.entitlements e
      left join public.plans pl on pl.id = e.plan_id
      where e.user_id = p_user_id
    ),
    jsonb_build_object('entitlementStatus', null)
  );
$$;

revoke all on function private.account_deletion_snapshot(uuid) from public, anon, authenticated;
grant execute on function private.account_deletion_snapshot(uuid) to service_role;

-- One request row as the API hands it out.
create or replace function private.account_deletion_request_json(r public.account_deletion_requests)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', r.id,
    'userId', r.user_id,
    'email', r.email,
    'fullName', r.full_name,
    'reason', r.reason,
    'status', r.status,
    'requestedAt', r.requested_at,
    'decidedAt', r.decided_at,
    'decidedBy', r.decided_by,
    'decisionNote', r.decision_note,
    'scheduledFor', r.scheduled_for,
    'completedAt', r.completed_at,
    'attempts', r.attempts,
    'lastAttemptAt', r.last_attempt_at,
    'lastError', r.last_error,
    'snapshot', r.snapshot
  );
$$;

revoke all on function private.account_deletion_request_json(public.account_deletion_requests) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. The reader's side
-- -----------------------------------------------------------------------------

create or replace function public.account_deletion_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_open boolean;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  select * into v_req
  from public.account_deletion_requests r
  where r.user_id = v_uid
  order by r.requested_at desc
  limit 1;

  v_open := found and v_req.status in ('pending', 'approved', 'processing', 'failed');
  v_blockers := private.account_deletion_blockers(v_uid);

  return jsonb_build_object(
    'request', case when found then private.account_deletion_request_json(v_req) end,
    'canRequest', (not v_open) and v_blockers = '[]'::jsonb,
    'blockers', v_blockers,
    'warnings', private.account_deletion_warnings(v_uid),
    'graceDays', extract(epoch from private.account_deletion_grace())::int / 86400
  );
end;
$$;

comment on function public.account_deletion_status() is
  'The signed-in reader''s latest deletion request plus whether a new one may be filed (blockers) and what to warn about first (warnings).';

revoke all on function public.account_deletion_status() from public, anon;
grant execute on function public.account_deletion_status() to authenticated, service_role;

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
  where p.id = v_uid;

  if not found then
    -- No profile row (should not happen): still record the request.
    insert into public.account_deletion_requests (user_id, email, reason, snapshot)
    values (v_uid, auth.jwt() ->> 'email', v_reason, private.account_deletion_snapshot(v_uid));
  end if;

  return public.account_deletion_status();
end;
$$;

comment on function public.request_account_deletion(text) is
  'Files a deletion request for the signed-in reader. Raises SUBSCRIPTION_ACTIVE / BILLING_UNRESOLVED / ADMIN_ACCOUNT / REQUEST_EXISTS with the human message in detail.';

revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated, service_role;

create or replace function public.cancel_account_deletion_request()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;

  -- `processing` is the executor mid-run; too late to pull back.
  update public.account_deletion_requests r
  set status = 'cancelled',
      decided_at = coalesce(r.decided_at, timezone('utc', now())),
      scheduled_for = null
  where r.user_id = v_uid and r.status in ('pending', 'approved', 'failed')
  returning r.id into v_id;

  if v_id is null then
    raise exception 'NO_OPEN_REQUEST' using detail = 'There is no deletion request to cancel.', errcode = 'P0002';
  end if;

  return public.account_deletion_status();
end;
$$;

comment on function public.cancel_account_deletion_request() is
  'Withdraws the signed-in reader''s open deletion request (pending, approved-and-waiting, or failed).';

revoke all on function public.cancel_account_deletion_request() from public, anon;
grant execute on function public.cancel_account_deletion_request() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. The admin's side
-- -----------------------------------------------------------------------------

create or replace function public.admin_deletion_requests(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_counts jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select coalesce(jsonb_agg(
    private.account_deletion_request_json(r)
      || jsonb_build_object(
        'blockers', case when r.status in ('pending', 'approved', 'failed')
          then private.account_deletion_blockers(r.user_id) else '[]'::jsonb end,
        'profileExists', exists (select 1 from public.profiles p where p.id = r.user_id),
        'decidedByEmail', (select p.email from public.profiles p where p.id = r.decided_by)
      )
    order by
      case r.status when 'failed' then 0 when 'pending' then 1 when 'approved' then 2 when 'processing' then 3 else 4 end,
      r.requested_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.account_deletion_requests r
  where r.id in (
    select x.id from public.account_deletion_requests x
    where p_status is null
       or (p_status = 'open' and x.status in ('pending', 'approved', 'processing', 'failed'))
       or x.status = p_status
    order by x.requested_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  );

  select jsonb_object_agg(s.status, s.n)
  into v_counts
  from (
    select status, count(*)::int as n
    from public.account_deletion_requests
    group by status
  ) s;

  return jsonb_build_object(
    'rows', v_rows,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'graceDays', extract(epoch from private.account_deletion_grace())::int / 86400
  );
end;
$$;

comment on function public.admin_deletion_requests(text, integer) is
  'Admin: deletion requests, newest first, with each open row''s current blockers. p_status: a status, ''open'', or null for all.';

revoke all on function public.admin_deletion_requests(text, integer) from public, anon;
grant execute on function public.admin_deletion_requests(text, integer) to authenticated, service_role;

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

  -- A failed run is retried by approving it again; anything past that is final.
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

  -- Tell the reader. A deleted token row simply means nothing is sent.
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

  select * into v_req from public.account_deletion_requests where id = p_request_id;
  return private.account_deletion_request_json(v_req);
end;
$$;

comment on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) is
  'Admin: approve (schedules the run after the grace period, or now with p_immediate) or reject a pending / failed deletion request. Audited; the reader is notified.';

revoke all on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.admin_decide_deletion_request(uuid, boolean, text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. The executor's side (service role only)
-- -----------------------------------------------------------------------------

-- Takes the due rows out of the queue. The status flip is what stops a second
-- runner (or a reader's cancel) from racing the deletion.
create or replace function public.account_deletion_claim(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_rows jsonb;
begin
  with due as (
    select r.id
    from public.account_deletion_requests r
    where r.status = 'approved'
      and r.scheduled_for is not null
      and r.scheduled_for <= timezone('utc', now())
    order by r.scheduled_for
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  claimed as (
    update public.account_deletion_requests r
    set status = 'processing',
        attempts = r.attempts + 1,
        last_attempt_at = timezone('utc', now())
    from due
    where r.id = due.id
    returning r.id
  )
  select coalesce(array_agg(claimed.id), '{}'::uuid[]) into v_ids from claimed;

  -- Read back in a second statement: the CTE's writes are not visible to the
  -- statement that made them, and the executor wants the row as it now is.
  select coalesce(jsonb_agg(
    private.account_deletion_request_json(r)
      || jsonb_build_object('blockers', private.account_deletion_blockers(r.user_id))
    order by r.scheduled_for
  ), '[]'::jsonb)
  into v_rows
  from public.account_deletion_requests r
  where r.id = any(v_ids);

  return v_rows;
end;
$$;

revoke all on function public.account_deletion_claim(integer) from public, anon, authenticated;
grant execute on function public.account_deletion_claim(integer) to service_role;

-- The executor's verdict on one claimed row.
create or replace function public.account_deletion_mark(
  p_request_id uuid,
  p_outcome text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('completed', 'failed') then
    raise exception 'invalid outcome %', p_outcome using errcode = '22023';
  end if;

  update public.account_deletion_requests r
  set status = p_outcome,
      completed_at = case when p_outcome = 'completed' then timezone('utc', now()) end,
      last_error = case when p_outcome = 'failed' then left(p_error, 1000) end,
      scheduled_for = case when p_outcome = 'completed' then r.scheduled_for else null end
  where r.id = p_request_id and r.status = 'processing';

  if p_outcome = 'completed' then
    insert into public.admin_audit_log (
      actor_id, actor_email, action, entity_type, entity_id, entity_label, changes
    )
    select
      null,
      'system',
      'delete',
      'account_deletion_request',
      r.id::text,
      coalesce(r.email, r.user_id::text),
      jsonb_build_object('userId', r.user_id, 'completedAt', r.completed_at)
    from public.account_deletion_requests r
    where r.id = p_request_id;
  end if;
end;
$$;

revoke all on function public.account_deletion_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.account_deletion_mark(uuid, text, text) to service_role;

-- Same shape as push_dispatch_kick: config in private.runtime_config, an
-- asynchronous pg_net call, a no-op with a notice when unconfigured.
create or replace function private.account_deletion_kick()
returns boolean
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.account_deletion_requests
    where status = 'approved' and scheduled_for <= timezone('utc', now())
  ) then
    return false;
  end if;

  select value into v_url from private.runtime_config where key = 'supabase_url';
  select value into v_secret from private.runtime_config where key = 'account_deletion_secret';

  if v_url is null or v_secret is null then
    raise notice 'account_deletion_kick: runtime_config missing supabase_url/account_deletion_secret; nothing sent';
    return false;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/account-deletion-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', v_secret,
      'User-Agent', 'ilm-o-irfan-account-deletion-kick/1'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );

  return true;
end;
$fn$;

comment on function private.account_deletion_kick() is
  'Fires the account-deletion-run Edge Function when an approved request is due. No-op until private.runtime_config has supabase_url and account_deletion_secret.';

revoke all on function private.account_deletion_kick() from public, anon, authenticated;
grant execute on function private.account_deletion_kick() to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('account-deletion-tick')
    where exists (select 1 from cron.job where jobname = 'account-deletion-tick');
    perform cron.schedule(
      'account-deletion-tick',
      '*/15 * * * *',
      $cron$select private.account_deletion_kick()$cron$
    );
  else
    raise warning 'pg_cron unavailable: account-deletion-tick NOT scheduled. Approved requests run only when an admin presses Run now.';
  end if;
exception
  when others then
    raise warning 'could not schedule account-deletion-tick (%)', sqlerrm;
end;
$do$;
