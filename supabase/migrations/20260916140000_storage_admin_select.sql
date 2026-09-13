-- =============================================================================
-- Admins can see the covers and pdfs buckets through the Storage API
-- =============================================================================
-- The orphan delete on System → Storage returned 200 and an empty list: the
-- Storage API deletes with `DELETE ... RETURNING`, and under RLS a returned row
-- must also pass a SELECT policy. covers lost its public SELECT policy in
-- 20260905140000 (to stop anonymous listing) and pdfs never had one (every
-- reader download goes through get-signed-pdf), so as far as the API could
-- see there was nothing to delete — for admins included.
--
-- Two SELECT policies, admin-only. Readers are unchanged: covers still render
-- from the public URL, which never consults RLS, and a reader still cannot
-- list either bucket or fetch a PDF without an entitlement check. An admin can
-- now list, delete and sign objects in the buckets they already manage.
-- =============================================================================

drop policy if exists "covers_admin_read" on storage.objects;
create policy "covers_admin_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'covers'
    and (select public.is_admin())
  );

drop policy if exists "pdfs_admin_read" on storage.objects;
create policy "pdfs_admin_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pdfs'
    and (select public.is_admin())
  );
