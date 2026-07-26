-- =============================================================================
-- Storage buckets + policies
-- covers: public read | pdfs: private (signed URLs) | avatars: owner only
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'covers',
    'covers',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  ),
  (
    'pdfs',
    'pdfs',
    false,
    104857600,
    array['application/pdf']
  ),
  (
    'avatars',
    'avatars',
    false,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Covers: anyone can read; writes via service role / dashboard
create policy "covers_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'covers');

-- PDFs: no direct client SELECT (Edge Function issues signed URLs)
-- Service role bypasses RLS for signed URL generation.

-- Avatars: users manage files under {user_id}/...
create policy "avatars_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
