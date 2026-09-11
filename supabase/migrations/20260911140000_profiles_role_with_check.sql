-- Harden profiles_update_own so a future GRANT on profiles.role cannot
-- let a user escalate themselves via WITH CHECK only checking id.
-- Column privileges already omit role; this is defense in depth.

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and role is not distinct from (
      select p.role from public.profiles p where p.id = (select auth.uid())
    )
  );
