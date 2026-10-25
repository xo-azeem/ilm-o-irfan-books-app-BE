-- =============================================================================
-- Recommendations: evaluate auth.uid() once per query, not once per row
--
-- 20260814114738 rebuilt every policy then in the schema so that auth.uid()
-- and is_admin() were wrapped in a scalar subquery — `(select auth.uid())` —
-- which Postgres evaluates once, as an initPlan, and then compares each row
-- against the cached result. Bare, `auth.uid()` is a function call the planner
-- cannot hoist, so it runs again for every row the policy is checked against.
--
-- The recommendation tables arrived three weeks later (20260908130200) and
-- were written the old way, so these two policies are the only ones in the
-- schema still paying per-row. `user_recommendations` is not idle: it is what
-- the "Because you read" rail reads, on every Home load, and it grows by a
-- rank per book per reader.
--
-- The policies are otherwise identical — same name, same command, same role,
-- same predicate — so nothing changes about who can read what. Both columns
-- are already the leading column of a primary key, so the comparison was
-- always indexed; this removes the function call in front of it.
--
-- Found with `supabase inspect db` and the Supabase Postgres best-practices
-- rule `security-rls-performance`.
-- =============================================================================

drop policy if exists "user_taste_state_select_own" on public.user_taste_state;
create policy "user_taste_state_select_own"
  on public.user_taste_state for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "user_recommendations_select_own" on public.user_recommendations;
create policy "user_recommendations_select_own"
  on public.user_recommendations for select
  to authenticated
  using (user_id = (select auth.uid()));
