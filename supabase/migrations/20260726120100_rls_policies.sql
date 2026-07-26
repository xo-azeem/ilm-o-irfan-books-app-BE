-- =============================================================================
-- Row Level Security — catalog public read; user data own-row only
-- Entitlements: SELECT own; writes via service role only
-- =============================================================================

alter table public.authors enable row level security;
alter table public.books enable row level security;
alter table public.categories enable row level security;
alter table public.book_categories enable row level security;
alter table public.collections enable row level security;
alter table public.collection_books enable row level security;
alter table public.profiles enable row level security;
alter table public.reading_progress enable row level security;
alter table public.wishlist enable row level security;
alter table public.downloads enable row level security;
alter table public.highlights enable row level security;
alter table public.reading_streaks enable row level security;
alter table public.plans enable row level security;
alter table public.entitlements enable row level security;

-- Catalog (public SELECT of published content)
create policy "authors_public_read"
  on public.authors for select
  to anon, authenticated
  using (true);

create policy "books_public_read_published"
  on public.books for select
  to anon, authenticated
  using (is_published = true);

create policy "categories_public_read"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "book_categories_public_read"
  on public.book_categories for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.is_published = true
    )
  );

create policy "collections_public_read_published"
  on public.collections for select
  to anon, authenticated
  using (is_published = true);

create policy "collection_books_public_read"
  on public.collection_books for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.is_published = true
    )
    and exists (
      select 1 from public.books b
      where b.id = book_id and b.is_published = true
    )
  );

create policy "plans_public_read_active"
  on public.plans for select
  to anon, authenticated
  using (is_active = true);

-- Profiles
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Reading progress
create policy "reading_progress_select_own"
  on public.reading_progress for select
  to authenticated
  using (user_id = auth.uid());

create policy "reading_progress_insert_own"
  on public.reading_progress for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "reading_progress_update_own"
  on public.reading_progress for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reading_progress_delete_own"
  on public.reading_progress for delete
  to authenticated
  using (user_id = auth.uid());

-- Wishlist
create policy "wishlist_select_own"
  on public.wishlist for select
  to authenticated
  using (user_id = auth.uid());

create policy "wishlist_insert_own"
  on public.wishlist for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "wishlist_delete_own"
  on public.wishlist for delete
  to authenticated
  using (user_id = auth.uid());

-- Downloads (metadata only)
create policy "downloads_select_own"
  on public.downloads for select
  to authenticated
  using (user_id = auth.uid());

create policy "downloads_insert_own"
  on public.downloads for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "downloads_update_own"
  on public.downloads for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "downloads_delete_own"
  on public.downloads for delete
  to authenticated
  using (user_id = auth.uid());

-- Highlights
create policy "highlights_select_own"
  on public.highlights for select
  to authenticated
  using (user_id = auth.uid());

create policy "highlights_insert_own"
  on public.highlights for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "highlights_update_own"
  on public.highlights for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "highlights_delete_own"
  on public.highlights for delete
  to authenticated
  using (user_id = auth.uid());

-- Reading streaks
create policy "reading_streaks_select_own"
  on public.reading_streaks for select
  to authenticated
  using (user_id = auth.uid());

create policy "reading_streaks_update_own"
  on public.reading_streaks for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Entitlements: users may read own; no client writes
create policy "entitlements_select_own"
  on public.entitlements for select
  to authenticated
  using (user_id = auth.uid());

-- Explicit deny of client writes is default when no INSERT/UPDATE/DELETE policies exist.
-- Service role bypasses RLS for RevenueCat webhook.
