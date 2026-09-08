-- =============================================================================
-- 14 · Subscription-only catalogue
-- pgAdmin mirror of supabase/migrations/20260909140000_subscription_only_catalogue.sql
--
-- Every title requires an active membership. The access rule lives in
-- get-signed-pdf, which requires an entitlement (or the admin role) for every
-- book and no longer reads is_premium. This is the data half.
--
-- Run after 13_restrict_covers_listing.sql. Safe to re-run.
-- =============================================================================

-- New books are premium unless someone says otherwise.
alter table public.books
  alter column is_premium set default true;

comment on column public.books.is_premium is
  'Labels a title as paid. Defaults true: the catalogue is subscription-only. '
  'This does NOT decide PDF access - get-signed-pdf requires an active '
  'entitlement (or admin) for every book regardless of this flag.';

-- Flip the catalogue so premium=true stops returning an empty page.
update public.books
set is_premium = true
where is_premium = false;

-- Remove the bypass column. 06_app_settings.sql created it (default true) and
-- 08_search_views_and_admin_fixes.sql forced it false; nothing has read it
-- since. A dormant column named "serve paid content to everyone" is worth more
-- deleted than documented.
alter table public.app_settings
  drop column if exists allow_pdf_without_entitlement;
