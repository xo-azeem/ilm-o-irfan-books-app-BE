-- =============================================================================
-- Search indexes for the admin People directory and the book slug
-- =============================================================================
-- The admin app searches people with `full_name ilike '%q%' or email ilike
-- '%q%' or phone ilike '%q%'` against admin_user_directory, and the book list
-- with the same shape over title, author_name and slug. Books and authors have
-- had trigram GIN indexes on title / name since the initial schema, so those
-- two branches are index scans; profiles has never had a search index of any
-- kind and slug has none, so those branches are sequential scans of the whole
-- table on every keystroke that reaches the server.
--
-- pg_trgm's gin_trgm_ops serves ILIKE with a leading wildcard, which a btree
-- cannot. The planner uses it once the term is three characters or longer,
-- which is also the length at which the app's search is worth running.
--
-- The directory is paged newest-first, so created_at gets a btree with id as
-- the tie-break — the same order the admin-users endpoint and the app both
-- ask for — so each page is a range read rather than a sort of every reader.
-- =============================================================================

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name gin_trgm_ops);

create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);

create index if not exists profiles_phone_trgm_idx
  on public.profiles using gin (phone gin_trgm_ops);

create index if not exists profiles_created_at_idx
  on public.profiles (created_at desc, id);

create index if not exists books_slug_trgm_idx
  on public.books using gin (slug gin_trgm_ops);
