-- =============================================================================
-- Fix: profile-update broken for every user since 20260911140000
--
-- That migration rewrote profiles_update_own with a WITH CHECK that reads
-- public.profiles from inside a policy on public.profiles:
--
--   role is not distinct from (select p.role from public.profiles p where ...)
--
-- A policy subquery on its own table re-enters RLS on that table, and
-- Postgres refuses:  "infinite recursion detected in policy for relation
-- profiles".  Every UPDATE fails, so every profile-update call returns
-- PROFILE_UPDATE_FAILED. Confirmed on the hosted project on 2026-09-12.
--
-- The intent was sound - a reader must not be able to change their own role -
-- and it was already enforced: authenticated holds column-level UPDATE on
-- profiles that omits `role`. The WITH CHECK is defense in depth against a
-- future GRANT widening that. Keep the defence, break the recursion: read the
-- current role through a SECURITY DEFINER function, which runs outside RLS and
-- therefore does not re-enter the policy.
--
-- The helper only ever returns the caller's own role, so granting it to
-- authenticated leaks nothing they could not already select.
-- =============================================================================

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$fn$;

comment on function public.current_profile_role() is
  'The caller''s own profiles.role, read outside RLS so a profiles policy can '
  'reference it without recursing into itself.';

revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated, service_role;

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and role is not distinct from (select public.current_profile_role())
  );
