-- =============================================================================
-- Orphan clean-up: the database checks, the Storage API deletes
-- =============================================================================
-- admin_delete_storage_object() ended with `delete from storage.objects`.
-- Supabase Storage now installs a trigger (protect_objects_delete) that
-- refuses any direct SQL delete on storage.objects with
--
--   42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- so every "Delete" on the System → Storage screen failed, for admins too.
-- A row delete was the wrong tool anyway: it would have left the file itself
-- behind in the bucket, which is exactly the orphan the screen exists to
-- remove.
--
-- The function keeps its name and signature so both callers (the app, which
-- calls it over PostgREST, and the admin-delete-storage-object Edge Function)
-- still work, but it now only does the part the database is good at: confirm
-- the caller is an admin, the bucket is one we manage, and nothing still
-- points at the object. The caller then removes the object through the
-- Storage API, where the existing covers_admin_delete / pdfs_admin_delete
-- policies authorise the admin.
--
-- Also here: an author's portrait lives in the covers bucket (authors.avatar_path).
-- The audit already excluded those from the orphan list; the delete guard now
-- refuses them too, so an avatar can never be deleted by name.
-- =============================================================================

-- The return type changes (void -> boolean), which CREATE OR REPLACE refuses;
-- drop first. Grants are re-issued below, nothing else depends on it.
drop function if exists public.admin_delete_storage_object(text, text);

create function public.admin_delete_storage_object(p_bucket text, p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not (select public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_bucket not in ('covers', 'pdfs') then
    raise exception 'unsupported bucket' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.books b
    where regexp_replace(coalesce(b.cover_path, ''), '^covers/', '') = p_name
       or regexp_replace(coalesce(b.pdf_path, ''), '^pdfs/', '') = p_name
  ) then
    raise exception 'object is still referenced by a book' using errcode = '23503';
  end if;

  if p_bucket = 'covers' and exists (
    select 1 from public.authors a
    where regexp_replace(coalesce(a.avatar_path, ''), '^covers/', '') = p_name
  ) then
    raise exception 'object is still used as an author portrait' using errcode = '23503';
  end if;

  -- True when there is something to remove; the caller deletes it through
  -- the Storage API. A name that is already gone is not an error.
  return exists (
    select 1 from storage.objects o
    where o.bucket_id = p_bucket and o.name = p_name
  );
end;
$fn$;

comment on function public.admin_delete_storage_object(text, text) is
  'Admin: clears an orphaned cover/pdf for deletion (admin, managed bucket, unreferenced). Returns whether the object exists; the caller removes it through the Storage API.';

revoke all on function public.admin_delete_storage_object(text, text) from public;
revoke execute on function public.admin_delete_storage_object(text, text) from anon;
grant execute on function public.admin_delete_storage_object(text, text)
  to authenticated, service_role;
