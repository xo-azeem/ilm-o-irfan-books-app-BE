-- =============================================================================
-- Keep the launch-path Edge Functions warm
--
-- Measured on the hosted project, 2026-09-12: a function idle for ~10 minutes
-- answers in 1.3-1.8s; the same function a second later answers in ~0.3s. That
-- is the Deno isolate being spun up, and it is paid by whichever real reader
-- happens to open the app first after a quiet spell - which, for an app with a
-- small early audience, is most readers most of the time.
--
-- There is no provisioned concurrency for Edge Functions, so this does the
-- next best thing: a pg_cron job fires an asynchronous HTTP GET at each
-- launch-path function every three minutes via pg_net. The functions that need
-- a user JWT are pinged with the anon key and answer 401 AUTH_REQUIRED - that
-- is fine, the isolate still boots to produce it, which is the whole point.
--
-- Cost: 11 targets x 20 pings/hour x 24 = ~5,300 invocations a day, ~160k a
-- month. Free tier is 500k/month. Turn it off with:
--   select cron.unschedule('warm-edge-functions');
--
-- Config lives in private.runtime_config rather than the migration, so this
-- file is not tied to one project. The anon key is not a secret - it ships in
-- the app - but the URL differs per environment. With no config the job is a
-- no-op that logs once, so a fresh local stack does not start pinging nothing.
-- =============================================================================

create extension if not exists pg_net;

create table if not exists private.runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table private.runtime_config is
  'Per-environment values SQL jobs need and migrations must not hardcode. '
  'Not exposed through the API. Service role only.';

revoke all on table private.runtime_config from public, anon, authenticated;
grant all on table private.runtime_config to service_role;

-- The functions the app touches on launch and first interaction. Pure catalogue
-- rails that home-feed already embeds (carousel-list, trending-weekly) are left
-- out: nothing calls them on the launch path.
create or replace function private.warm_edge_functions()
returns integer
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url text;
  v_key text;
  v_target text;
  v_count integer := 0;
  v_targets constant text[] := array[
    'home-feed',
    'books-list?pageSize=20',
    'books-search?q=a',
    'book-detail?id=00000000-0000-0000-0000-000000000000',
    'categories-list',
    'collections-list',
    'plans-list',
    'entitlements-status',
    'recommendations',
    'library-overview',
    'get-signed-pdf'
  ];
begin
  select value into v_url from private.runtime_config where key = 'supabase_url';
  select value into v_key from private.runtime_config where key = 'anon_key';

  if v_url is null or v_key is null then
    raise notice 'warm_edge_functions: runtime_config missing supabase_url/anon_key; nothing pinged';
    return 0;
  end if;

  v_url := rtrim(v_url, '/');

  foreach v_target in array v_targets loop
    -- Asynchronous: net.http_get queues the request and returns immediately,
    -- so eleven pings cost this job milliseconds, not eleven round trips.
    -- get-signed-pdf is POST-only and answers 405 to a GET; the isolate boots
    -- either way.
    perform net.http_get(
      url := v_url || '/functions/v1/' || v_target,
      headers := jsonb_build_object(
        'apikey', v_key,
        'Authorization', 'Bearer ' || v_key,
        'User-Agent', 'ilm-o-irfan-keep-warm/1'
      ),
      timeout_milliseconds := 8000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

comment on function private.warm_edge_functions() is
  'Fires async GETs at the launch-path Edge Functions so readers do not pay '
  'the ~1.5s isolate cold start. No-op until private.runtime_config has '
  'supabase_url and anon_key.';

revoke all on function private.warm_edge_functions() from public, anon, authenticated;
grant execute on function private.warm_edge_functions() to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('warm-edge-functions')
    where exists (select 1 from cron.job where jobname = 'warm-edge-functions');

    perform cron.schedule(
      'warm-edge-functions',
      '*/3 * * * *',
      $cron$select private.warm_edge_functions()$cron$
    );
  end if;
exception
  when others then
    raise warning 'could not schedule warm-edge-functions (%)', sqlerrm;
end;
$do$;
