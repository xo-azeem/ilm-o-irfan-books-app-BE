-- =============================================================================
-- Push notifications
-- =============================================================================
-- Readers are told, on the device's own tray, about the changes that matter
-- to them: a new book or collection on Home, and a book they hold being
-- removed, replaced or edited. A membership that starts or ends is announced
-- the same way. Nothing here sends anything itself — the database records what
-- happened and who should hear about it, and an Edge Function (`push-dispatch`)
-- turns those rows into FCM requests.
--
-- Three pieces:
--
--   1. `device_push_tokens` — one row per (device, signed-in reader). Written
--      only through `register_push_token` / `unregister_push_token`, so a row
--      always belongs to the caller. Two per-token preference flags mirror the
--      switches on the app's Notifications screen; new-book announcements go
--      out on an FCM *topic* the device subscribes to itself, so they need no
--      row at all.
--
--   2. `push_outbox` — the queue. A row is one notification-to-be, with its
--      audience (a topic, or a list of user ids) and the facts the dispatcher
--      composes the text from. Pending rows for the same (kind, entity) merge,
--      so an admin who saves a book four times in a minute produces one push,
--      not four. `deliver_after` gives the merge its window.
--
--   3. Triggers on `books`, `collections`, `collection_books` and
--      `access_events`, plus a hook in `admin_publish_upload_batch` — a batch
--      publish is one event ("12 new books in Tafsir"), so the per-row triggers
--      are silenced for the transaction and the RPC enqueues once.
--
-- The dispatcher is kicked through pg_net the moment a due row lands, and a
-- minutely pg_cron tick catches merged rows whose window has closed and any
-- retry. Both read `private.runtime_config` for the project URL and the shared
-- secret; with neither set this is inert — rows accumulate and nothing is
-- sent, which is the correct behaviour on a fresh local stack.
--
-- Privileges are opt-in as of 20260913130000: every grant below is explicit.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. device_push_tokens
-- -----------------------------------------------------------------------------

create table if not exists public.device_push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null,
  app_version text,
  device_name text,
  notify_library boolean not null default true,
  notify_membership boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  disabled_at timestamptz,
  disabled_reason text,
  constraint device_push_tokens_platform_check check (platform in ('android', 'ios')),
  constraint device_push_tokens_token_not_blank check (length(trim(token)) > 0)
);

comment on table public.device_push_tokens is
  'FCM registration tokens, one per device and signed-in reader. Written only through register_push_token / unregister_push_token. disabled_at is set by the dispatcher when FCM reports the token dead.';

create index if not exists device_push_tokens_user_idx
  on public.device_push_tokens (user_id)
  where disabled_at is null;

create index if not exists device_push_tokens_last_seen_idx
  on public.device_push_tokens (last_seen_at);

drop trigger if exists device_push_tokens_set_updated_at on public.device_push_tokens;
create trigger device_push_tokens_set_updated_at
before update on public.device_push_tokens
for each row execute function public.set_updated_at();

alter table public.device_push_tokens enable row level security;

-- A reader may see their own devices. Nothing else: every write goes through
-- the two RPCs below, which scope to auth.uid() themselves.
drop policy if exists "device_push_tokens_select_own" on public.device_push_tokens;
create policy "device_push_tokens_select_own"
  on public.device_push_tokens for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.device_push_tokens from public, anon, authenticated;
grant select on table public.device_push_tokens to authenticated;
grant all on table public.device_push_tokens to service_role;

-- Registers (or re-claims) the calling reader's token. A token that belonged
-- to whoever was signed in on this device before is simply reassigned: FCM
-- tokens are per app install, not per account, and the previous reader signed
-- out. Called at sign-in, on every token refresh, once per launch to keep
-- last_seen_at honest, and whenever a preference switch is flipped.
create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_app_version text default null,
  p_device_name text default null,
  p_notify_library boolean default true,
  p_notify_membership boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'token is required' using errcode = '22023';
  end if;

  if p_platform not in ('android', 'ios') then
    raise exception 'platform must be android or ios' using errcode = '22023';
  end if;

  insert into public.device_push_tokens as t (
    token, user_id, platform, app_version, device_name,
    notify_library, notify_membership, last_seen_at
  )
  values (
    trim(p_token), v_user, p_platform,
    nullif(left(trim(coalesce(p_app_version, '')), 40), ''),
    nullif(left(trim(coalesce(p_device_name, '')), 80), ''),
    coalesce(p_notify_library, true),
    coalesce(p_notify_membership, true),
    timezone('utc', now())
  )
  on conflict (token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      app_version = coalesce(excluded.app_version, t.app_version),
      device_name = coalesce(excluded.device_name, t.device_name),
      notify_library = excluded.notify_library,
      notify_membership = excluded.notify_membership,
      last_seen_at = excluded.last_seen_at,
      disabled_at = null,
      disabled_reason = null;
end;
$$;

comment on function public.register_push_token(text, text, text, text, boolean, boolean) is
  'Upserts the caller''s FCM token with its preference flags. Reassigns a token another reader left behind on the same device.';

revoke all on function public.register_push_token(text, text, text, text, boolean, boolean) from public;
revoke execute on function public.register_push_token(text, text, text, text, boolean, boolean) from anon;
grant execute on function public.register_push_token(text, text, text, text, boolean, boolean) to authenticated, service_role;

-- Drops the token on sign-out, or when the reader turns targeted pushes off.
-- Scoped to the caller: a reader cannot silence another reader's device.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.device_push_tokens
  where token = trim(coalesce(p_token, ''))
    and user_id = auth.uid();
$$;

revoke all on function public.unregister_push_token(text) from public;
revoke execute on function public.unregister_push_token(text) from anon;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. push_outbox
-- -----------------------------------------------------------------------------
-- The dispatcher composes title and body from `kind`, `data` and `count`, so
-- copy lives in one place (the Edge Function) and a merged row does not carry
-- text written for a count of one.

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  audience text not null,
  topic text,
  recipients uuid[] not null default '{}',
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  count integer not null default 1,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  sent_count integer,
  failed_count integer,
  deliver_after timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  constraint push_outbox_kind_check check (kind in (
    'books_published',
    'collection_published',
    'collection_books_added',
    'book_deleted',
    'book_file_replaced',
    'book_updated',
    'membership_activated',
    'membership_expired'
  )),
  constraint push_outbox_audience_check check (audience in ('topic', 'users')),
  constraint push_outbox_topic_check check (
    (audience = 'topic' and topic is not null) or (audience = 'users' and topic is null)
  ),
  constraint push_outbox_status_check check (
    status in ('pending', 'processing', 'sent', 'failed', 'skipped')
  ),
  constraint push_outbox_count_positive check (count > 0)
);

comment on table public.push_outbox is
  'Notifications waiting to be sent. Filled by triggers, drained by the push-dispatch Edge Function. Pending rows for the same (kind, entity_id) merge.';

-- The merge target. Partial, so a row that has already been picked up leaves
-- room for a fresh one: a second edit a minute after the first is a second
-- notification, which is right.
create unique index if not exists push_outbox_pending_merge_idx
  on public.push_outbox (kind, entity_id)
  where status = 'pending' and entity_id is not null;

create index if not exists push_outbox_due_idx
  on public.push_outbox (deliver_after)
  where status = 'pending';

create index if not exists push_outbox_processed_idx
  on public.push_outbox (processed_at)
  where status in ('sent', 'failed', 'skipped');

drop trigger if exists push_outbox_set_updated_at on public.push_outbox;
create trigger push_outbox_set_updated_at
before update on public.push_outbox
for each row execute function public.set_updated_at();

alter table public.push_outbox enable row level security;

-- No client policy at all: the queue is the server's business.
revoke all on table public.push_outbox from public, anon, authenticated;
grant all on table public.push_outbox to service_role;

-- Marks the pending, due rows as being worked on and hands them over. One
-- transaction, `skip locked`, so two dispatcher runs cannot send the same row.
-- A row left in `processing` for ten minutes is a run that died mid-way; it is
-- taken again.
create or replace function public.push_outbox_claim(p_limit integer default 50)
returns setof public.push_outbox
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from public.push_outbox
    where (status = 'pending' and deliver_after <= timezone('utc', now()))
       or (status = 'processing' and updated_at < timezone('utc', now()) - interval '10 minutes')
    order by deliver_after
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update public.push_outbox o
  set status = 'processing',
      attempts = o.attempts + 1
  from due
  where o.id = due.id
  returning o.*;
$$;

revoke all on function public.push_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.push_outbox_claim(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Enqueue helpers
-- -----------------------------------------------------------------------------

-- The admin who made the change. An RPC called with the caller's JWT has
-- auth.uid(); an Edge Function writing with the service-role key sends the
-- verified caller as x-audit-actor-id, the same header private.audit_write()
-- trusts, and only on a service_role request.
create or replace function private.push_actor_id()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_headers jsonb;
begin
  if v_actor is not null then
    return v_actor;
  end if;

  if not (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or coalesce(current_setting('role', true), '') = 'service_role'
  ) then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;

  begin
    return nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- Set for the length of one transaction by the batch publisher, so the
-- per-statement triggers stay quiet while it publishes a set.
create or replace function private.push_suppressed()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.push_suppress', true), '') = '1';
$$;

-- "Users who have this book": downloaded it, read any of it, saved it, or
-- marked a page in it. Whoever made the change is left out — an admin does
-- not need a push about their own edit.
create or replace function private.book_holders(p_book_id uuid)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
  from (
    select d.user_id from public.downloads d where d.book_id = p_book_id and d.status <> 'failed'
    union
    select rp.user_id from public.reading_progress rp where rp.book_id = p_book_id
    union
    select w.user_id from public.wishlist w where w.book_id = p_book_id
    union
    select h.user_id from public.highlights h where h.book_id = p_book_id
  ) u
  where u.user_id is distinct from private.push_actor_id();
$$;

-- Adds a row to the outbox, or folds it into the pending row for the same
-- (kind, entity). On a merge the newest facts win (a renamed book is
-- announced under its new title), the recipient lists are unioned, the counts
-- add up, and the window is pushed out again.
create or replace function private.push_enqueue(
  p_kind text,
  p_audience text,
  p_topic text,
  p_recipients uuid[],
  p_entity_id uuid,
  p_data jsonb,
  p_count integer default 1,
  p_delay interval default interval '0'
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_audience = 'users' and (p_recipients is null or array_length(p_recipients, 1) is null) then
    return;
  end if;

  insert into public.push_outbox as o (
    kind, audience, topic, recipients, entity_id, data, count, deliver_after
  )
  values (
    p_kind,
    p_audience,
    case when p_audience = 'topic' then p_topic end,
    coalesce(p_recipients, '{}'::uuid[]),
    p_entity_id,
    coalesce(p_data, '{}'::jsonb),
    greatest(1, coalesce(p_count, 1)),
    timezone('utc', now()) + coalesce(p_delay, interval '0')
  )
  on conflict (kind, entity_id) where status = 'pending' and entity_id is not null
  do update
  set recipients = (
        select coalesce(array_agg(distinct r), '{}'::uuid[])
        from unnest(o.recipients || excluded.recipients) as r
      ),
      data = o.data || excluded.data,
      count = o.count + excluded.count,
      deliver_after = greatest(o.deliver_after, excluded.deliver_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Kicking the dispatcher
-- -----------------------------------------------------------------------------
-- Same shape as the keep-warm job: config in private.runtime_config, an
-- asynchronous pg_net call, a no-op with a notice when unconfigured. The Edge
-- Function checks the secret before touching anything.

create or replace function private.push_dispatch_kick()
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
    select 1 from public.push_outbox
    where status = 'pending' and deliver_after <= timezone('utc', now())
  ) then
    return false;
  end if;

  select value into v_url from private.runtime_config where key = 'supabase_url';
  select value into v_secret from private.runtime_config where key = 'push_dispatch_secret';

  if v_url is null or v_secret is null then
    raise notice 'push_dispatch_kick: runtime_config missing supabase_url/push_dispatch_secret; nothing sent';
    return false;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret,
      'User-Agent', 'ilm-o-irfan-push-kick/1'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );

  return true;
end;
$fn$;

comment on function private.push_dispatch_kick() is
  'Fires the push-dispatch Edge Function when the outbox has due rows. No-op until private.runtime_config has supabase_url and push_dispatch_secret.';

revoke all on function private.push_dispatch_kick() from public, anon, authenticated;
grant execute on function private.push_dispatch_kick() to service_role;

-- A row that is due right now is worth a kick right now. Rows written with a
-- merge window are left to the minutely tick.
create or replace function private.push_outbox_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.push_dispatch_kick();
  return null;
end;
$$;

drop trigger if exists push_outbox_kick on public.push_outbox;
create trigger push_outbox_kick
after insert on public.push_outbox
for each statement execute function private.push_outbox_after_insert();

-- Sent rows are a log, not a queue; two weeks is plenty for "did that go
-- out?". Dead tokens are kept a month so a dispatcher log line can still be
-- matched to one, and a device not seen in four months has long since been
-- refreshed or wiped.
create or replace function public.prune_push_tables()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_part integer;
begin
  delete from public.push_outbox
  where status in ('sent', 'failed', 'skipped')
    and processed_at < timezone('utc', now()) - interval '14 days';
  get diagnostics v_part = row_count;
  v_count := v_count + v_part;

  delete from public.device_push_tokens
  where (disabled_at is not null and disabled_at < timezone('utc', now()) - interval '30 days')
     or last_seen_at < timezone('utc', now()) - interval '120 days';
  get diagnostics v_part = row_count;
  v_count := v_count + v_part;

  return v_count;
end;
$$;

revoke all on function public.prune_push_tables() from public, anon, authenticated;
grant execute on function public.prune_push_tables() to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('push-dispatch-tick')
    where exists (select 1 from cron.job where jobname = 'push-dispatch-tick');
    perform cron.schedule(
      'push-dispatch-tick',
      '* * * * *',
      $cron$select private.push_dispatch_kick()$cron$
    );

    perform cron.unschedule('prune-push-tables')
    where exists (select 1 from cron.job where jobname = 'prune-push-tables');
    perform cron.schedule(
      'prune-push-tables',
      '41 3 * * *',
      $cron$select public.prune_push_tables()$cron$
    );
  else
    raise warning 'pg_cron unavailable: push-dispatch-tick NOT scheduled. Rows are still sent on insert; merged rows wait for the next insert.';
  end if;
exception
  when others then
    raise warning 'could not schedule push jobs (%)', sqlerrm;
end;
$do$;

-- -----------------------------------------------------------------------------
-- 5. Collections: which have already been announced
-- -----------------------------------------------------------------------------
-- A collection is announced once, when it is first published *with* at least
-- one live book — an empty shelf on Home is nothing to shout about, so a
-- collection created before its books arrive is announced when they do.
-- Kept in its own table rather than a column on collections, so marking it
-- does not show up as an admin edit in the audit log.

create table if not exists private.push_announced_collections (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  announced_at timestamptz not null default timezone('utc', now())
);

revoke all on table private.push_announced_collections from public, anon, authenticated;
grant all on table private.push_announced_collections to service_role;

create or replace function private.collection_push_facts(p_collection_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'collectionId', c.id,
    'collectionTitle', c.title,
    'collectionSlug', c.slug,
    'collectionSubtitle', c.subtitle,
    'publishedCount', (
      select count(*) from public.collection_books cb
      join public.books b on b.id = cb.book_id
      where cb.collection_id = c.id and b.is_published and b.pdf_path is not null
    )
  )
  from public.collections c
  where c.id = p_collection_id
    and c.is_published
    and not (c.slug = any (public.system_collection_slugs()));
$$;

-- Announces the collection if it is live, has live books, and has not been
-- announced. Returns true when it did.
create or replace function private.push_announce_collection(p_collection_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_facts jsonb;
begin
  if exists (select 1 from private.push_announced_collections where collection_id = p_collection_id) then
    return false;
  end if;

  v_facts := private.collection_push_facts(p_collection_id);
  if v_facts is null or coalesce((v_facts ->> 'publishedCount')::int, 0) = 0 then
    return false;
  end if;

  insert into private.push_announced_collections (collection_id)
  values (p_collection_id)
  on conflict do nothing;

  perform private.push_enqueue(
    'collection_published', 'topic', 'catalog', null,
    p_collection_id, v_facts,
    (v_facts ->> 'publishedCount')::int
  );
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Books going live
-- -----------------------------------------------------------------------------
-- Statement-level, so publishing twelve titles in one bulk update is one row
-- ("12 new books"), not twelve. If every book that went live sits in the same
-- (live, non-system) collection, that collection is named and linked; and if
-- that collection had never been announced, this is its announcement instead.
--
-- Two thin trigger functions (an INSERT has no OLD TABLE) feed one worker.

create or replace function private.push_books_went_live(p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_ids, '{}'::uuid[]);
  v_count integer;
  v_book record;
  v_collection uuid;
  v_facts jsonb;
begin
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return;
  end if;

  -- A live, non-system collection that holds every one of them.
  select cb.collection_id
  into v_collection
  from public.collection_books cb
  join public.collections c on c.id = cb.collection_id
  where cb.book_id = any (v_ids)
    and c.is_published
    and not (c.slug = any (public.system_collection_slugs()))
  group by cb.collection_id, c.sort_order
  having count(distinct cb.book_id) = v_count
  order by c.sort_order
  limit 1;

  if v_collection is not null and private.push_announce_collection(v_collection) then
    return;
  end if;

  v_facts := jsonb_build_object('count', v_count);
  if v_collection is not null then
    v_facts := v_facts || coalesce(private.collection_push_facts(v_collection), '{}'::jsonb);
  end if;

  if v_count = 1 then
    select b.id, b.title, a.name as author
    into v_book
    from public.books b
    join public.authors a on a.id = b.author_id
    where b.id = v_ids[1];

    v_facts := v_facts || jsonb_build_object(
      'bookId', v_book.id,
      'bookTitle', v_book.title,
      'author', v_book.author
    );

    perform private.push_enqueue(
      'books_published', 'topic', 'catalog', null, v_book.id, v_facts, 1
    );
  else
    perform private.push_enqueue(
      'books_published', 'topic', 'catalog', null, null, v_facts, v_count
    );
  end if;
end;
$$;

create or replace function private.push_books_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if private.push_suppressed() then
    return null;
  end if;

  select coalesce(array_agg(n.id), '{}'::uuid[])
  into v_ids
  from new_rows n
  where n.is_published and n.pdf_path is not null;

  perform private.push_books_went_live(v_ids);
  return null;
end;
$$;

create or replace function private.push_books_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if private.push_suppressed() then
    return null;
  end if;

  select coalesce(array_agg(n.id), '{}'::uuid[])
  into v_ids
  from new_rows n
  join old_rows o on o.id = n.id
  where n.is_published and not o.is_published and n.pdf_path is not null;

  perform private.push_books_went_live(v_ids);
  return null;
end;
$$;

drop trigger if exists books_push_published_insert on public.books;
create trigger books_push_published_insert
after insert on public.books
referencing new table as new_rows
for each statement execute function private.push_books_inserted();

-- No `of is_published` column list: Postgres refuses transition tables on a
-- trigger with one (0A000). The function does the old/new comparison itself,
-- so an UPDATE that touches nothing else costs one join over two empty sets.
drop trigger if exists books_push_published_update on public.books;
create trigger books_push_published_update
after update on public.books
referencing old table as old_rows new table as new_rows
for each statement execute function private.push_books_published();

-- -----------------------------------------------------------------------------
-- 7. A book a reader holds: deleted, replaced, edited
-- -----------------------------------------------------------------------------
-- All three are row-level and BEFORE the write, because the recipients come
-- from tables the write itself empties: deletion cascades through downloads,
-- progress, wishlist and highlights, and a PDF replacement deletes downloads
-- (20260917130000). The recipient list is therefore captured while it exists.
--
-- Trigger names sort before `books_pdf_replaced_*`, so on a replacement the
-- holders are read before the stamp trigger runs; the order does not matter
-- for correctness, but it keeps the two independent.

create or replace function private.push_book_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holders uuid[];
begin
  v_holders := private.book_holders(old.id);
  if coalesce(array_length(v_holders, 1), 0) > 0 then
    perform private.push_enqueue(
      'book_deleted', 'users', null, v_holders, old.id,
      jsonb_build_object('bookId', old.id, 'bookTitle', old.title),
      1
    );
  end if;
  return old;
end;
$$;

drop trigger if exists books_push_deleted on public.books;
create trigger books_push_deleted
before delete on public.books
for each row execute function private.push_book_deleted();

create or replace function private.push_book_file_replaced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holders uuid[];
begin
  v_holders := private.book_holders(old.id);
  if coalesce(array_length(v_holders, 1), 0) > 0 then
    perform private.push_enqueue(
      'book_file_replaced', 'users', null, v_holders, old.id,
      jsonb_build_object('bookId', old.id, 'bookTitle', new.title),
      1
    );
  end if;
  return new;
end;
$$;

-- Only a *replacement* of a live book's file. A draft getting its first PDF,
-- or an unpublished title being re-uploaded, is nobody's business yet.
drop trigger if exists books_push_file_replaced on public.books;
create trigger books_push_file_replaced
before update of pdf_path on public.books
for each row
when (
  old.pdf_path is distinct from new.pdf_path
  and old.pdf_path is not null
  and new.pdf_path is not null
  and old.is_published
)
execute function private.push_book_file_replaced();

create or replace function private.push_book_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holders uuid[];
begin
  if private.push_suppressed() then
    return new;
  end if;

  v_holders := private.book_holders(old.id);
  if coalesce(array_length(v_holders, 1), 0) > 0 then
    -- A two-minute window: the admin panel saves a book in one write, but a
    -- typo fixed straight after should not arrive as a second push.
    perform private.push_enqueue(
      'book_updated', 'users', null, v_holders, old.id,
      jsonb_build_object('bookId', old.id, 'bookTitle', new.title),
      1,
      interval '2 minutes'
    );
  end if;
  return new;
end;
$$;

-- Reader-visible fields only. A rating tick, a tag, a price or the file
-- itself (announced separately above) does not count as "this book changed".
drop trigger if exists books_push_updated on public.books;
create trigger books_push_updated
before update on public.books
for each row
when (
  old.is_published and new.is_published
  and old.pdf_path is not distinct from new.pdf_path
  and (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.author_id is distinct from new.author_id
    or old.cover_path is distinct from new.cover_path
    or old.page_count is distinct from new.page_count
    or old.read_time_minutes is distinct from new.read_time_minutes
    or old.language is distinct from new.language
    or old.genre is distinct from new.genre
  )
)
execute function private.push_book_updated();

-- -----------------------------------------------------------------------------
-- 8. Collections
-- -----------------------------------------------------------------------------

create or replace function private.push_collection_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.push_suppressed() then
    return null;
  end if;
  perform private.push_announce_collection(new.id);
  return null;
end;
$$;

drop trigger if exists collections_push_published on public.collections;
create trigger collections_push_published
after insert or update of is_published on public.collections
for each row
when (new.is_published)
execute function private.push_collection_published();

-- Books joining a collection. For a collection nobody has heard of yet this
-- is its announcement; for one already on Home it is "N new books in …",
-- held for two minutes so an admin adding titles one by one sends once.
-- Only live books count: a draft dropped into a shelf is invisible to readers
-- and is announced when it is published (section 6 names the shelf then).
create or replace function private.push_collection_books_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_facts jsonb;
begin
  if private.push_suppressed() then
    return null;
  end if;

  for v_row in
    select n.collection_id, count(*)::int as added
    from new_rows n
    join public.books b on b.id = n.book_id
    where b.is_published and b.pdf_path is not null
    group by n.collection_id
  loop
    if private.push_announce_collection(v_row.collection_id) then
      continue;
    end if;

    v_facts := private.collection_push_facts(v_row.collection_id);
    if v_facts is null then
      continue;
    end if;

    if not exists (
      select 1 from private.push_announced_collections
      where collection_id = v_row.collection_id
    ) then
      -- Live but empty of live books even after this insert: nothing to say.
      continue;
    end if;

    perform private.push_enqueue(
      'collection_books_added', 'topic', 'catalog', null,
      v_row.collection_id, v_facts, v_row.added,
      interval '2 minutes'
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists collection_books_push_added on public.collection_books;
create trigger collection_books_push_added
after insert on public.collection_books
referencing new table as new_rows
for each statement execute function private.push_collection_books_added();

-- -----------------------------------------------------------------------------
-- 9. Membership
-- -----------------------------------------------------------------------------
-- access_events already records every change in a reader's access, in the
-- order it happened (identity id). A push goes out only when is_active flips,
-- so the minutely expiry sweep re-asserting "still expired" stays silent.
-- Admins are skipped: their access never actually changes.

create or replace function private.push_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_active boolean;
begin
  if new.is_admin then
    return null;
  end if;

  select e.is_active
  into v_prev_active
  from public.access_events e
  where e.user_id = new.user_id and e.id < new.id
  order by e.id desc
  limit 1;

  if v_prev_active is not distinct from new.is_active then
    return null;
  end if;

  -- A first-ever event that is inactive is a fresh account being looked at,
  -- not a membership ending.
  if v_prev_active is null and not new.is_active then
    return null;
  end if;

  perform private.push_enqueue(
    case when new.is_active then 'membership_activated' else 'membership_expired' end,
    'users', null, array[new.user_id], new.user_id,
    jsonb_build_object(
      'userId', new.user_id,
      'status', new.status,
      'expiresAt', new.expires_at
    ),
    1
  );

  return null;
end;
$$;

drop trigger if exists access_events_push_membership on public.access_events;
create trigger access_events_push_membership
after insert on public.access_events
for each row execute function private.push_membership_change();

-- -----------------------------------------------------------------------------
-- 10. Bulk uploads announce once
-- -----------------------------------------------------------------------------
-- Same body as 20260918120000, plus: the per-statement triggers are silenced
-- for this transaction, and one row is enqueued for whatever went live — the
-- collection's announcement if it had none, "N new books in <collection>" if it
-- had, or "N new books" when the batch has no destination.

create or replace function public.admin_publish_upload_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.upload_batches%rowtype;
  v_ids uuid[];
  v_result jsonb;
  v_skipped int;
  v_live int;
  v_done boolean := false;
  v_facts jsonb;
  v_book record;
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select * into v_batch from public.upload_batches where id = p_batch_id;
  if not found then
    raise exception 'upload batch not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(b.id), '{}'::uuid[])
  into v_ids
  from public.books b
  where b.upload_batch_id = p_batch_id;

  if array_length(v_ids, 1) is null then
    raise exception 'upload batch has no books' using errcode = '22023';
  end if;

  -- One announcement for the set, enqueued below; the row triggers stay quiet.
  perform set_config('app.push_suppress', '1', true);

  if v_batch.collection_id is not null then
    insert into public.collection_books (collection_id, book_id, sort_order)
    select
      v_batch.collection_id,
      t.id,
      coalesce(
        (select max(cb.sort_order) from public.collection_books cb
          where cb.collection_id = v_batch.collection_id),
        -1
      ) + t.ord
    from unnest(v_ids) with ordinality as t(id, ord)
    on conflict do nothing;
  end if;

  if v_batch.category_id is not null then
    insert into public.book_categories (book_id, category_id)
    select t.id, v_batch.category_id
    from unnest(v_ids) as t(id)
    on conflict do nothing;
  end if;

  v_result := public.admin_bulk_update_books(v_ids, true, null);
  v_skipped := coalesce((v_result ->> 'skipped')::int, 0);

  select count(*)::int into v_live
  from public.books b
  where b.upload_batch_id = p_batch_id and b.is_published;

  -- Published only when every book in the set is live.
  if v_skipped = 0 and v_live = array_length(v_ids, 1) then
    update public.upload_batches
    set status = 'published',
        published_at = coalesce(published_at, timezone('utc', now()))
    where id = p_batch_id;

    if v_batch.collection_id is not null then
      update public.collections
      set is_published = true
      where id = v_batch.collection_id and is_published = false;
    end if;

    v_done := true;
  end if;

  -- Whatever went live is news, whether or not the batch closed cleanly.
  if v_live > 0 then
    if v_batch.collection_id is not null
       and private.push_announce_collection(v_batch.collection_id) then
      null;
    else
      v_facts := jsonb_build_object('count', v_live);
      if v_batch.collection_id is not null then
        v_facts := v_facts || coalesce(private.collection_push_facts(v_batch.collection_id), '{}'::jsonb);
      end if;

      if v_live = 1 then
        select b.id, b.title, a.name as author
        into v_book
        from public.books b
        join public.authors a on a.id = b.author_id
        where b.upload_batch_id = p_batch_id and b.is_published
        limit 1;

        v_facts := v_facts || jsonb_build_object(
          'bookId', v_book.id, 'bookTitle', v_book.title, 'author', v_book.author
        );
        perform private.push_enqueue(
          'books_published', 'topic', 'catalog', null, v_book.id, v_facts, 1
        );
      elsif v_batch.collection_id is not null
            and jsonb_exists(v_facts, 'collectionId') then
        perform private.push_enqueue(
          'collection_books_added', 'topic', 'catalog', null,
          v_batch.collection_id, v_facts, v_live
        );
      else
        perform private.push_enqueue(
          'books_published', 'topic', 'catalog', null, null, v_facts, v_live
        );
      end if;
    end if;
  end if;

  return v_result || jsonb_build_object('batchPublished', v_done);
end;
$$;

revoke all on function public.admin_publish_upload_batch(uuid) from public;
revoke execute on function public.admin_publish_upload_batch(uuid) from anon;
grant execute on function public.admin_publish_upload_batch(uuid) to authenticated, service_role;
