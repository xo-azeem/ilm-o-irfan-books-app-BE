-- =============================================================================
-- A replaced or deleted book leaves every device
-- =============================================================================
-- A reader who downloads a book holds a sealed copy of one particular file on
-- their device, and the app opens it from there without a round trip — that
-- is what a download is for. Two things the admin panel does make that copy
-- wrong: deleting the book, and replacing its PDF. Deletion already cascades
-- through every per-reader table (downloads, reading_progress, wishlist,
-- highlights); replacement did nothing at all, so `downloads` went on saying
-- a reader had the book when what they had was the old file. And in neither
-- case could a device find out, because nothing described *which* file it
-- held.
--
-- Three pieces, all small:
--
--   1. books.pdf_updated_at — the instant the current file was attached.
--      Every upload lands at a fresh storage path, so a change of pdf_path
--      is exactly "the file was replaced", and a trigger stamps it.
--   2. The same trigger deletes the book's downloads rows. The row is the
--      server's record that a reader has the file on their device; after a
--      replacement nobody has the new one, so the record is false for every
--      reader at once. Deleting mirrors what a book delete already does.
--   3. vault_check(uuid[]) — the one read a device needs: for the books it
--      holds, which still exist and what their current file stamp is. Absent
--      means deleted; a different stamp means replaced. One call for the
--      whole vault, at sign-in, on foreground, and behind every offline open.
--
-- get-signed-pdf returns the same stamp, so a device records which file it
-- downloaded at the moment it downloads it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The file stamp
-- -----------------------------------------------------------------------------

alter table public.books
  add column if not exists pdf_updated_at timestamptz;

-- Existing rows: the best we know is that the current file has been there
-- since the row was last touched. Devices holding a copy adopt this stamp on
-- their first check rather than being told their download is stale.
update public.books
set pdf_updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where pdf_updated_at is null;

alter table public.books
  alter column pdf_updated_at set default timezone('utc', now()),
  alter column pdf_updated_at set not null;

comment on column public.books.pdf_updated_at is
  'When the current pdf_path was attached. Bumped by trigger on every change of pdf_path; devices compare it against the copy they hold.';

-- -----------------------------------------------------------------------------
-- 2. Replacing the file
-- -----------------------------------------------------------------------------

create or replace function public.books_pdf_replaced()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- BEFORE: stamp the row that is about to be written.
  if tg_when = 'BEFORE' then
    if new.pdf_path is distinct from old.pdf_path then
      new.pdf_updated_at := timezone('utc', now());
    end if;
    return new;
  end if;

  -- AFTER: the old file is gone for every reader who had it. A row that
  -- merely re-saved the same path is not a replacement and touches nothing.
  if new.pdf_path is distinct from old.pdf_path then
    delete from public.downloads where book_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists books_pdf_replaced_stamp on public.books;
create trigger books_pdf_replaced_stamp
  before update of pdf_path on public.books
  for each row execute function public.books_pdf_replaced();

drop trigger if exists books_pdf_replaced_downloads on public.books;
create trigger books_pdf_replaced_downloads
  after update of pdf_path on public.books
  for each row execute function public.books_pdf_replaced();

-- -----------------------------------------------------------------------------
-- 3. What a device asks
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so an unpublished book still answers: a reader who
-- downloaded a title the admin has since taken off sale has not lost the
-- file, only the ability to fetch it again, and a temporarily unpublished
-- book must not wipe every reader's download. Only ids the caller already
-- holds are echoed back, and only to a signed-in user; a uuid is not
-- guessable, so this confirms nothing a caller did not already know.
--
-- The array is capped: the vault on a device holds a handful of books, and
-- a caller sending thousands of ids is not a device.
-- -----------------------------------------------------------------------------

create or replace function public.vault_check(p_book_ids uuid[])
returns table (
  book_id uuid,
  pdf_updated_at timestamptz,
  has_pdf boolean,
  is_published boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    b.id,
    b.pdf_updated_at,
    b.pdf_path is not null,
    b.is_published
  from public.books b
  where auth.uid() is not null
    and b.id = any ((coalesce(p_book_ids, '{}'::uuid[]))[1:200]);
$fn$;

comment on function public.vault_check(uuid[]) is
  'For the books a device holds offline: which still exist and when their current file was attached. Absent = deleted; a newer pdf_updated_at = replaced.';

revoke all on function public.vault_check(uuid[]) from public;
revoke execute on function public.vault_check(uuid[]) from anon;
grant execute on function public.vault_check(uuid[]) to authenticated, service_role;
