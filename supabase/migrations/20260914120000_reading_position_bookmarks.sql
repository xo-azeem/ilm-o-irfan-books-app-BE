-- =============================================================================
-- Reading position + page bookmarks: persistent, replay-safe, one round trip
-- =============================================================================
-- The reader syncs its page in bursts (debounced while flipping, once on close)
-- and queues those writes while offline. Two things were missing for that to be
-- safe:
--
-- 1. A write carried no notion of *when* the reader was at that page, so an
--    offline queue replayed out of order could push a stale page over a newer
--    one. upsert_reading_progress now takes p_client_updated_at and applies
--    last-write-wins against the stored last_read_at inside the same statement.
--
-- 2. Page bookmarks had no key. A double tap on the bookmark button made two
--    rows, and "is this page bookmarked?" needed a list call. highlights gets a
--    unique (user_id, book_id, page_number) and two RPCs — upsert_highlight and
--    toggle_highlight — so the button is one call that cannot duplicate.
--
-- Nothing here changes the write cost: every trigger on reading_progress is a
-- single keyed upsert already (streak, taste signal, learned page count) and
-- they stay as they are.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. reading_progress: replay-safe upsert
-- -----------------------------------------------------------------------------
-- Same partial-merge semantics as before (null = leave alone, '' clears the
-- chapter), plus:
--
--   p_client_updated_at   when given, the write only lands if the stored
--                         last_read_at is not newer; last_read_at becomes this
--                         value rather than now(). Equal timestamps apply, so
--                         replaying the same queue entry twice is idempotent.
--
--   current_page clamp    the PDF view can report one page past the end for a
--                         frame; that is clamped to total_pages instead of
--                         rejected. Anything further past is still a 22023.
--
-- Returns the row that is stored *after* the call either way, with `applied`
-- saying whether this call wrote it. The old five-argument overload is dropped
-- rather than kept beside the new one: PostgREST cannot pick between two
-- overloads whose only difference is a defaulted trailing argument.

drop function if exists public.upsert_reading_progress(uuid, integer, integer, numeric, text);

create or replace function public.upsert_reading_progress(
  p_book_id uuid,
  p_current_page integer default null,
  p_total_pages integer default null,
  p_progress numeric default null,
  p_chapter_label text default null,
  p_client_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.reading_progress;
  v_applied boolean := false;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- One statement: the conflict row is locked before the WHERE is evaluated,
  -- so two devices syncing at once cannot both think they are newer.
  insert into public.reading_progress as rp (
    user_id, book_id, current_page, total_pages, progress, chapter_label, last_read_at
  )
  values (
    v_uid,
    p_book_id,
    coalesce(p_current_page, 1),
    p_total_pages,
    coalesce(p_progress, 0),
    nullif(p_chapter_label, ''),
    coalesce(p_client_updated_at, timezone('utc', now()))
  )
  on conflict (user_id, book_id) do update
  set
    current_page = coalesce(p_current_page, rp.current_page),
    total_pages = coalesce(p_total_pages, rp.total_pages),
    progress = coalesce(p_progress, rp.progress),
    chapter_label = case
      when p_chapter_label is null then rp.chapter_label
      when p_chapter_label = '' then null
      else p_chapter_label
    end,
    last_read_at = coalesce(p_client_updated_at, timezone('utc', now()))
  where p_client_updated_at is null
     or rp.last_read_at <= p_client_updated_at
  returning * into v_row;

  if found then
    v_applied := true;

    -- Checked on the merged row, not on the request: sending current_page
    -- alone must not be able to push it past a total_pages already stored.
    if v_row.total_pages is not null and v_row.current_page > v_row.total_pages then
      if v_row.current_page = v_row.total_pages + 1 then
        update public.reading_progress
        set current_page = v_row.total_pages
        where id = v_row.id
        returning * into v_row;
      else
        raise exception 'current_page % exceeds total_pages %',
          v_row.current_page, v_row.total_pages
          using errcode = '22023';
      end if;
    end if;
  else
    -- The stored row was newer than the caller's timestamp. Hand it back so
    -- the client can reconcile its cache to what actually won.
    select * into v_row
    from public.reading_progress
    where user_id = v_uid and book_id = p_book_id;
  end if;

  return to_jsonb(v_row) || jsonb_build_object('applied', v_applied);
end;
$$;

comment on function public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz) is
  'Partial-merge upsert of the caller''s reading position. With p_client_updated_at the write is last-write-wins against last_read_at; the result is the stored row plus applied=true|false.';

revoke all on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz) from public;
revoke execute on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz) from anon;
grant execute on function
  public.upsert_reading_progress(uuid, integer, integer, numeric, text, timestamptz)
  to authenticated, service_role;

-- The launch-time hydrate reads every row for one user newest-first. This index
-- has existed since the initial schema; restated here so the migration is the
-- whole story for the read path.
create index if not exists reading_progress_user_last_read_idx
  on public.reading_progress (user_id, last_read_at desc);

-- -----------------------------------------------------------------------------
-- 2. highlights: one bookmark per page
-- -----------------------------------------------------------------------------
-- Existing duplicates are collapsed first, keeping the oldest row per key so an
-- id the app already holds keeps working wherever possible.

delete from public.highlights h
using public.highlights older
where h.page_number is not null
  and older.user_id = h.user_id
  and older.book_id = h.book_id
  and older.page_number = h.page_number
  and (older.created_at, older.id) < (h.created_at, h.id);

-- A full (not partial) unique index on purpose. NULLs are distinct in a unique
-- index, so a text highlight with no page never collides and the guarantee is
-- exactly "one row per (user, book, page) where page is set" — but unlike a
-- partial index this one also carries the reader's list query
-- (WHERE user_id = ? AND book_id = ? ORDER BY page_number) and can back a
-- PostgREST on_conflict upsert from the app's direct-table fallback.
create unique index if not exists highlights_user_book_page_key
  on public.highlights (user_id, book_id, page_number);

-- Fully covered by the unique index above (same leading columns).
drop index if exists public.highlights_user_book_idx;

-- Save-or-update a page bookmark. On conflict the fields the caller did not
-- send are left alone (null), '' clears one — the same convention as
-- chapter_label. `created` is true only when this call inserted the row.
create or replace function public.upsert_highlight(
  p_book_id uuid,
  p_page_number integer,
  p_note text default null,
  p_color text default null,
  p_text_excerpt text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rec record;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_page_number is null or p_page_number < 1 then
    raise exception 'page_number must be >= 1' using errcode = '22023';
  end if;

  insert into public.highlights as h (
    user_id, book_id, page_number, note, color, text_excerpt
  )
  values (
    v_uid,
    p_book_id,
    p_page_number,
    nullif(p_note, ''),
    nullif(p_color, ''),
    nullif(p_text_excerpt, '')
  )
  on conflict (user_id, book_id, page_number) do update
  set
    note = case
      when p_note is null then h.note
      when p_note = '' then null
      else p_note
    end,
    color = case
      when p_color is null then h.color
      when p_color = '' then null
      else p_color
    end,
    text_excerpt = case
      when p_text_excerpt is null then h.text_excerpt
      when p_text_excerpt = '' then null
      else p_text_excerpt
    end
  -- xmax is 0 on a freshly inserted tuple and non-zero on one an UPDATE
  -- touched: the standard way to tell the two branches of an upsert apart.
  returning *, (xmax = 0) as created into v_rec;

  return to_jsonb(v_rec);
end;
$$;

comment on function public.upsert_highlight(uuid, integer, text, text, text) is
  'Upsert of the caller''s bookmark on (book_id, page_number). Returns the row plus created=true|false.';

revoke all on function public.upsert_highlight(uuid, integer, text, text, text) from public;
revoke execute on function public.upsert_highlight(uuid, integer, text, text, text) from anon;
grant execute on function public.upsert_highlight(uuid, integer, text, text, text)
  to authenticated, service_role;

-- The bookmark button: remove the bookmark if it is there, add it if not.
create or replace function public.toggle_highlight(
  p_book_id uuid,
  p_page_number integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.highlights;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_page_number is null or p_page_number < 1 then
    raise exception 'page_number must be >= 1' using errcode = '22023';
  end if;

  delete from public.highlights
  where user_id = v_uid and book_id = p_book_id and page_number = p_page_number
  returning * into v_row;

  if found then
    return jsonb_build_object('bookmarked', false, 'highlight', null);
  end if;

  -- Two taps racing each other: the second insert hits the unique index and
  -- takes the row the first one made instead of failing.
  insert into public.highlights (user_id, book_id, page_number)
  values (v_uid, p_book_id, p_page_number)
  on conflict (user_id, book_id, page_number) do nothing
  returning * into v_row;

  if not found then
    select * into v_row
    from public.highlights
    where user_id = v_uid and book_id = p_book_id and page_number = p_page_number;
  end if;

  return jsonb_build_object('bookmarked', true, 'highlight', to_jsonb(v_row));
end;
$$;

comment on function public.toggle_highlight(uuid, integer) is
  'Deletes the caller''s bookmark on (book_id, page_number) if present, else creates it. Returns { bookmarked, highlight }.';

revoke all on function public.toggle_highlight(uuid, integer) from public;
revoke execute on function public.toggle_highlight(uuid, integer) from anon;
grant execute on function public.toggle_highlight(uuid, integer)
  to authenticated, service_role;
