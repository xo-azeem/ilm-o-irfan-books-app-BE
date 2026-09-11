-- Admin authority: profiles.role only.
-- JWT app_metadata.app_role alone used to keep demoted admins privileged until
-- token refresh. Promotion still works immediately because we read profiles.role.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
parallel safe
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Clients must not read the full RevenueCat payload over PostgREST.
revoke select (raw_event) on table public.entitlements from authenticated, anon;
revoke select (raw_event) on table public.revenuecat_events from authenticated, anon;
