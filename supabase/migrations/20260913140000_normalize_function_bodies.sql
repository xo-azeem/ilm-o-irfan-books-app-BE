-- =============================================================================
-- Make `supabase db diff --linked` mean something again
-- =============================================================================
-- Two leftovers that are not bugs but never stop showing up in the schema diff,
-- and a diff that always has noise in it is a diff nobody reads.
--
-- 1. Function bodies with carriage returns. Migrations pushed from a Windows
--    checkout with core.autocrlf=true stored their function source with CRLF
--    line endings; the same files pushed from Linux or macOS stored LF. The
--    hosted database ended up with a mix, and whichever half does not match
--    the machine running `db diff` is reported as a changed function. The
--    bodies are otherwise byte-identical. .gitattributes now pins *.sql to LF,
--    and this rewrites every stored body without the CR so both sides agree
--    from here on. Whitespace-only: no function changes behaviour.
--
-- 2. pg_net registered under `public`. 20260912130000_edge_keep_warm.sql
--    created the extension without a schema; on the hosted project that
--    resolved to public, locally to extensions. pg_net is not relocatable, and
--    all its objects live in `net` either way, so this is only the extension's
--    own catalogue entry — but the diff prints it on every run. Drop and
--    recreate is the supported way to move it (it is what the dashboard
--    toggle does); the request queue it holds is transient by design.
-- =============================================================================

-- 2 first: it is the riskier of the two, and if it fails nothing else should
-- have moved.
do $do$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname = 'public'
  ) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end
$do$;

-- 1. Re-issue each affected function's own definition minus the CRs.
-- pg_get_functiondef returns the full CREATE OR REPLACE, including SECURITY
-- DEFINER and SET clauses, so ownership, privileges and comments survive.
-- Extension-owned functions are skipped: they are not ours to rewrite.
do $do$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and position(E'\r' in p.prosrc) > 0
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  loop
    execute replace(pg_get_functiondef(r.oid), E'\r', '');
    n := n + 1;
  end loop;

  raise notice 'normalized line endings in % function(s)', n;
end
$do$;
