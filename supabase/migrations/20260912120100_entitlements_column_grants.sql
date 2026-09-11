-- =============================================================================
-- Make the raw_event revoke from 20260911150000 actually take effect
--
-- That migration ran:
--   revoke select (raw_event) on public.entitlements from authenticated;
--
-- and it did nothing. Postgres column privileges are additive to table
-- privileges: authenticated holds table-level SELECT on entitlements, so a
-- column-level REVOKE has no effect - there is no column grant to remove, and
-- the table grant still covers every column. Verified on the hosted project on
-- 2026-09-12: `GET /rest/v1/entitlements?select=raw_event` returns the column.
--
-- To hide a column you revoke the table grant and grant the columns you mean.
-- The safe set is exactly what entitlements-status already selects. The
-- RevenueCat identifiers, the ordering guard and the raw webhook payload are
-- server-side concerns the device has no use for.
--
-- Nothing else reads entitlements as the user: get-signed-pdf and the webhook
-- use the service role, and my_access_state() is SECURITY DEFINER.
-- =============================================================================

revoke select on table public.entitlements from authenticated;

grant select (
  user_id,
  plan_id,
  status,
  starts_at,
  expires_at,
  store,
  created_at,
  updated_at
) on table public.entitlements to authenticated;

-- anon never had it; stated so a future GRANT ALL is a visible reversal.
revoke all on table public.entitlements from anon;
