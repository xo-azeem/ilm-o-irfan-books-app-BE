-- =============================================================================
-- No free books
--
-- The catalogue is subscription-only and now says so in the schema rather than
-- by convention. Only an admin reads without a membership; every other reader
-- needs an active entitlement for every title, with no exceptions.
--
-- Why this is needed when 20260909140000 already flipped the data: that
-- migration set the default and backfilled the rows, but left two ways to
-- make a book free again, and both were used —
--
--   * the admin book editor's "premium" switch, and
--   * the library's bulk "Make free" action
--     (admin_bulk_update_books with p_is_premium => false).
--
-- So the catalogue drifted back: titles marked free, sitting beside paid ones,
-- wearing the same "In membership" badge, because the badge never read the
-- flag either. The flag has never decided access — get-signed-pdf requires an
-- entitlement or the admin role whatever it says — so nothing was ever given
-- away. It was a merchandising bug, and this closes it.
--
-- The constraint is the point. A default is a suggestion; this makes a free
-- book impossible to write, from the app, from the admin tool, from psql, or
-- from a future endpoint nobody has reviewed yet. If a free sampler ever
-- becomes a product, dropping `books_no_free_titles` is a deliberate, visible
-- act — which is exactly the bar that decision should have to clear.
-- =============================================================================

-- 1 -------------------------------------------------------------------------
-- Bring back anything that drifted. Idempotent.

update public.books
set is_premium = true
where is_premium is distinct from true;

-- 2 -------------------------------------------------------------------------
-- And make it stay that way.
--
-- NOT VALID is deliberately not used: step 1 has just made every existing row
-- conform, so the table can be validated now rather than leaving a constraint
-- that is only enforced for new writes.

alter table public.books
  drop constraint if exists books_no_free_titles;

alter table public.books
  add constraint books_no_free_titles check (is_premium);

-- 3 -------------------------------------------------------------------------
-- The index on is_premium has nothing left to index.
--
-- `books_is_premium_idx` was a partial index over published books for the
-- Discover "in my membership" filter. With every row now constrained to the
-- same value it has no selectivity at all: a lookup through it returns the
-- whole table, so the planner will never choose it over a scan, and every
-- insert and update still pays to maintain it. The filter itself keeps
-- working — it matches every book, which is the truth.

drop index if exists public.books_is_premium_idx;

comment on column public.books.is_premium is
  'Always true: the catalogue is subscription-only and books_no_free_titles '
  'enforces it. Kept as a column rather than dropped so that reinstating a '
  'free tier is one migration rather than a schema change, but no book may '
  'be free while that constraint stands. This has never decided PDF access - '
  'get-signed-pdf requires an active entitlement (or admin) for every book.';
