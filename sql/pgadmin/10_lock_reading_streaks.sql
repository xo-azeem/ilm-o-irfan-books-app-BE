-- pgAdmin twin of 20260831150000_lock_reading_streaks.sql

drop policy if exists "reading_streaks_insert_own" on public.reading_streaks;
drop policy if exists "reading_streaks_update_own" on public.reading_streaks;

drop policy if exists "reading_streaks_select_own" on public.reading_streaks;
create policy "reading_streaks_select_own"
  on public.reading_streaks for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.reading_streaks from anon, authenticated;
grant select on table public.reading_streaks to authenticated;
grant all on table public.reading_streaks to service_role;
