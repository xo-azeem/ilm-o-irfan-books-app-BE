-- Lock reading_streaks to trigger-maintained values only.
-- Clients may SELECT their own row; INSERT/UPDATE go through private.touch_reading_streak().

drop policy if exists "reading_streaks_insert_own" on public.reading_streaks;
drop policy if exists "reading_streaks_update_own" on public.reading_streaks;

-- Keep select-own policy (recreate if missing from older DBs)
drop policy if exists "reading_streaks_select_own" on public.reading_streaks;
create policy "reading_streaks_select_own"
  on public.reading_streaks for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.reading_streaks from anon, authenticated;
grant select on table public.reading_streaks to authenticated;
grant all on table public.reading_streaks to service_role;

comment on table public.reading_streaks is
  'Maintained by private.touch_reading_streak on reading_progress writes. Clients SELECT only.';
