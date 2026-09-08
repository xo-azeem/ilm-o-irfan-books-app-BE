-- =============================================================================
-- Subscription-only catalogue
--
-- Product decision: every title requires an active membership. There is no
-- free tier and no per-book purchase.
--
-- The access rule itself lives in get-signed-pdf, which now requires an
-- entitlement (or the admin role) for every book and no longer looks at
-- is_premium at all. This migration handles the data half, so that the
-- catalogue agrees with the rule instead of merely being unable to contradict
-- it:
--
--   1. is_premium defaults to true, so a book added next month is not
--      accidentally free the moment someone forgets the flag.
--   2. The existing rows are flipped, so premium=true stops returning an
--      empty page in Discover.
--   3. app_settings.allow_pdf_without_entitlement is dropped. It was already
--      unread, and a dormant column named "serve paid content to everyone" is
--      worth more deleted than documented.
--
-- is_premium is deliberately kept as a column rather than dropped. It no
-- longer decides access, but it still labels a book, and a free sampler is a
-- plausible future product. Keeping it means that decision stays a product
-- one; the endpoint fails closed either way.
-- =============================================================================

-- 1 -------------------------------------------------------------------------
-- New books are premium unless someone says otherwise.

alter table public.books
  alter column is_premium set default true;

comment on column public.books.is_premium is
  'Labels a title as paid. Defaults true: the catalogue is subscription-only. '
  'This does NOT decide PDF access - get-signed-pdf requires an active '
  'entitlement (or admin) for every book regardless of this flag.';

-- 2 -------------------------------------------------------------------------
-- Flip the catalogue. Idempotent: re-running touches nothing.

update public.books
set is_premium = true
where is_premium = false;

-- 3 -------------------------------------------------------------------------
-- Remove the bypass column.
--
-- Nothing reads it: get-signed-pdf stopped consulting it, admin-settings never
-- exposed it for editing, and home-feed selects named columns. admin-settings
-- GET selects *, so this simply stops appearing in that response.

alter table public.app_settings
  drop column if exists allow_pdf_without_entitlement;
