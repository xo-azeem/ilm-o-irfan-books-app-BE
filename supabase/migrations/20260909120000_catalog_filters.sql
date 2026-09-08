-- =============================================================================
-- Discover filters, pushed into the database
-- =============================================================================
-- The app was asking for 20 rows and throwing away the ones that did not match.
-- That makes totalCount describe the page rather than the result, turns
-- hasNextPage into "more rows" instead of "more matches", and forces a
-- load-more loop to walk the whole catalogue to fill one screen.
--
-- Everything a Discover chip can express now happens in SQL, before LIMIT, so
-- the page meta describes the filtered set. One function, public.catalog_books,
-- backs both books-list and books-search: browsing is the same query with no
-- text term, so the two endpoints cannot drift apart on what a filter means.
--
-- Also here, because the filters need them:
--   * books.language      — the app was guessing language from title script
--   * books.page_count    — so "length" can eventually mean pages, not bytes
--   * a simple-config search vector for prefix ("jan" finds "Jannat")
--   * book_categories backfilled from genre, and kept in step
--   * category_with_counts fixed to count published books only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New book columns
-- -----------------------------------------------------------------------------

-- 'arabic' is allowed alongside the two the app asked for: this is an Islamic
-- studies catalogue and a source-language title is a question of when, not if.
-- NULL means "not recorded yet", which is not the same as English.
alter table public.books
  add column if not exists language text,
  add column if not exists page_count integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'books_language_check' and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_language_check
      check (language is null or language in ('urdu', 'english', 'arabic'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'books_page_count_positive' and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_page_count_positive
      check (page_count is null or page_count >= 1);
  end if;
end;
$$;

comment on column public.books.language is
  'Content language: urdu | english | arabic. NULL = not recorded.';
comment on column public.books.page_count is
  'Real page count when known. NULL falls back to an estimate from read_time_minutes.';

-- -----------------------------------------------------------------------------
-- 2. Length buckets
--
-- The app sends `length=short`; the database decides what that means, so the
-- boundary lives in one place instead of being duplicated in the client.
--
-- What is actually being measured is worth stating plainly: read_time_minutes
-- is not a measured reading time. scripts/import-folder-books.mjs derives it
-- from PDF file size at 40 KB per minute, and the app then divided it by 1.5 to
-- get "pages". So today's buckets are file size in a hat. page_count is the
-- honest field; when it is set it wins, and the estimate is only the fallback.
--
-- 1.5 minutes per page is kept deliberately: it is the constant the app already
-- used, so these buckets classify the current catalogue exactly as the client
-- filter did. Nothing moves shelf on the day this ships.
-- -----------------------------------------------------------------------------

create or replace function public.book_effective_pages(
  p_page_count integer,
  p_read_time_minutes integer
)
returns integer
language sql
immutable
parallel safe
as $fn$
  select case
    when p_page_count is not null then p_page_count
    when p_read_time_minutes is not null then greatest(1, ceil(p_read_time_minutes / 1.5)::integer)
    else null
  end;
$fn$;

create or replace function public.book_length_bucket(
  p_page_count integer,
  p_read_time_minutes integer
)
returns text
language sql
immutable
parallel safe
as $fn$
  select case
    when t.pages is null then null
    when t.pages < 200 then 'short'
    when t.pages < 600 then 'medium'
    else 'long'
  end
  from (select public.book_effective_pages(p_page_count, p_read_time_minutes) as pages) t;
$fn$;

comment on function public.book_length_bucket(integer, integer) is
  'short < 200 pages, medium 200-599, long >= 600. Pages = page_count, else read_time_minutes / 1.5. NULL when neither is known.';

grant execute on function public.book_effective_pages(integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.book_length_bucket(integer, integer)
  to anon, authenticated, service_role;

-- PostgREST computed column, so book-detail can select `length_bucket` without
-- the boundary being restated in TypeScript.
create or replace function public.length_bucket(b public.books)
returns text
language sql
stable
parallel safe
as $fn$
  select public.book_length_bucket(b.page_count, b.read_time_minutes);
$fn$;

grant execute on function public.length_bucket(public.books) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Prefix search
--
-- websearch_to_tsquery('english', 'jan') matches nothing until the whole word
-- is typed, which is useless for a field that searches on every keystroke. The
-- fix is a second vector built with the `simple` configuration — no stemming,
-- so a prefix match means what it looks like — queried with `:*`.
--
-- `english` stemming is also wrong for this catalogue: the titles are
-- transliterated Urdu, and an English stemmer mangles them.
--
-- NOTE: adding a STORED generated column rewrites the table. Trivial at 20
-- rows; schedule it if the catalogue is ever large.
-- -----------------------------------------------------------------------------

create or replace function public.books_search_vector_simple(
  title text,
  description text,
  genre text,
  tag text,
  tags text[]
)
returns tsvector
language sql
immutable
parallel safe
as $fn$
  select
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(genre, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(tag, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'C');
$fn$;

alter table public.books
  add column if not exists search_vector_simple tsvector
  generated always as (
    public.books_search_vector_simple(title, description, genre, tag, tags)
  ) stored;

create index if not exists books_search_vector_simple_idx
  on public.books using gin (search_vector_simple);

-- -----------------------------------------------------------------------------
-- 4. Filter indexes
--
-- Sized for the catalogue this will have, not the 20 rows it has. Every public
-- read is already filtered on is_published, so the predicates carry it.
-- -----------------------------------------------------------------------------

-- The default sort, tie-broken by id so paging is stable across requests.
create index if not exists books_published_at_id_idx
  on public.books (published_at desc, id desc)
  where is_published = true;

create index if not exists books_language_idx
  on public.books (language)
  where is_published = true;

create index if not exists books_length_bucket_idx
  on public.books (public.book_length_bucket(page_count, read_time_minutes))
  where is_published = true;

-- sort=title
create index if not exists books_title_id_idx
  on public.books (title, id desc)
  where is_published = true;

-- sort=rating, and minRating
create index if not exists books_rating_id_idx
  on public.books (rating desc, id desc)
  where is_published = true;

-- -----------------------------------------------------------------------------
-- 5. category_with_counts counted junction rows, not published books
--
-- The left join to books carried `is_published = true` in its ON clause, so an
-- unpublished title still contributed its junction row to count(bc.book_id).
-- The tile therefore promised books the filtered list would not return.
-- Counting b.id instead only counts rows that survived the join.
-- -----------------------------------------------------------------------------

create or replace view public.category_with_counts
with (security_invoker = true)
as
select
  c.id,
  c.slug,
  c.label,
  c.icon_key,
  c.accent,
  c.accent_dark,
  c.sort_order,
  count(b.id)::integer as book_count
from public.categories c
left join public.book_categories bc on bc.category_id = c.id
left join public.books b on b.id = bc.book_id and b.is_published = true
group by c.id;

-- -----------------------------------------------------------------------------
-- 6. book_categories: backfill from genre, and keep it populated
--
-- Every subject chip returned nothing because the junction table was empty
-- while books.genre was set on all of them. genre slugifies onto the existing
-- category slugs (Literature -> literature, History -> history), so the
-- backfill is exact rather than a guess.
--
-- Going forward a trigger fills it in, but ONLY for a book that has no
-- categories at all. An explicit admin choice — one category or five — is never
-- touched, so this cannot quietly undo curation.
-- -----------------------------------------------------------------------------

insert into public.book_categories (book_id, category_id)
select b.id, c.id
from public.books b
join public.categories c on c.slug = public.slugify(b.genre)
where b.genre is not null
  and not exists (
    select 1 from public.book_categories bc where bc.book_id = b.id
  )
on conflict do nothing;

create or replace function private.books_default_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.genre is null or length(trim(new.genre)) = 0 then
    return null;
  end if;

  -- Curation wins. Only an uncategorised book gets the genre default.
  if exists (select 1 from public.book_categories bc where bc.book_id = new.id) then
    return null;
  end if;

  insert into public.book_categories (book_id, category_id)
  select new.id, c.id
  from public.categories c
  where c.slug = public.slugify(new.genre)
  on conflict do nothing;

  return null;
end;
$fn$;

revoke all on function private.books_default_category() from public;
revoke all on function private.books_default_category() from anon, authenticated;

drop trigger if exists books_default_category on public.books;
create trigger books_default_category
after insert or update of genre on public.books
for each row execute function private.books_default_category();

-- -----------------------------------------------------------------------------
-- 7. Learn page_count from the reader
--
-- The one real page count in the system is the number the reader itself reports
-- when it opens a PDF. Recording it turns the length filter from an estimate of
-- a file size into a measurement, one book at a time, at no cost to anyone.
--
-- Only ever fills a NULL, so a value an admin typed is never overwritten, and
-- after the first reader of a book this matches zero rows.
-- -----------------------------------------------------------------------------

create or replace function private.books_learn_page_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.total_pages is null or new.total_pages < 1 then
    return null;
  end if;

  update public.books b
  set page_count = new.total_pages
  where b.id = new.book_id
    and b.page_count is null;

  return null;
end;
$fn$;

revoke all on function private.books_learn_page_count() from public;
revoke all on function private.books_learn_page_count() from anon, authenticated;

drop trigger if exists reading_progress_learn_page_count on public.reading_progress;
create trigger reading_progress_learn_page_count
after insert or update of total_pages on public.reading_progress
for each row execute function private.books_learn_page_count();

-- Seed from progress rows that already exist.
update public.books b
set page_count = rp.total_pages
from (
  select distinct on (book_id) book_id, total_pages
  from public.reading_progress
  where total_pages is not null and total_pages >= 1
  order by book_id, updated_at desc
) rp
where rp.book_id = b.id
  and b.page_count is null;

-- -----------------------------------------------------------------------------
-- 8. book_list_items gains language, page_count and length_bucket
--
-- Appended, so functions returning `setof public.book_list_items`
-- (random_published_books, weekly_trending_books) keep working unchanged.
-- -----------------------------------------------------------------------------

create or replace view public.book_list_items
with (security_invoker = true)
as
select
  b.id,
  b.slug,
  b.title,
  a.name as author_name,
  a.id as author_id,
  b.cover_path,
  b.cover_color,
  b.cover_color_dark,
  b.rating,
  b.tag,
  b.genre,
  b.read_time_minutes,
  b.price_cents,
  b.currency,
  b.format,
  b.is_premium,
  b.published_at,
  b.language,
  b.page_count,
  public.book_length_bucket(b.page_count, b.read_time_minutes) as length_bucket
from public.books b
join public.authors a on a.id = b.author_id
where b.is_published = true;

-- The CMS list needs the two new columns too, or an admin cannot see what they
-- are editing. Appended, so nothing that selects by position shifts.
create or replace view public.admin_book_rows
with (security_invoker = true) as
select
  b.id,
  b.slug,
  b.title,
  b.description,
  b.author_id,
  a.name as author_name,
  b.genre,
  b.tag,
  b.tags,
  b.rating,
  b.rating_count,
  b.price_cents,
  b.currency,
  b.format,
  b.cover_path,
  b.cover_color,
  b.cover_color_dark,
  b.pdf_path,
  b.file_size_bytes,
  b.read_time_minutes,
  b.is_premium,
  b.is_published,
  b.published_at,
  b.created_at,
  b.updated_at,
  coalesce(
    (select array_agg(bc.category_id) from public.book_categories bc where bc.book_id = b.id),
    '{}'::uuid[]
  ) as category_ids,
  coalesce(
    (select array_agg(cb.collection_id order by cb.sort_order)
     from public.collection_books cb where cb.book_id = b.id),
    '{}'::uuid[]
  ) as collection_ids,
  (select count(*)::int from public.reading_progress rp where rp.book_id = b.id) as reader_count,
  (select count(*)::int from public.downloads d
    where d.book_id = b.id and d.status = 'completed') as download_count,
  (select count(*)::int from public.wishlist w where w.book_id = b.id) as wishlist_count,
  b.language,
  b.page_count,
  public.book_length_bucket(b.page_count, b.read_time_minutes) as length_bucket
from public.books b
join public.authors a on a.id = b.author_id;

grant select on table public.admin_book_rows to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. catalog_books — the one query behind both list endpoints
--
-- Filters apply before LIMIT/OFFSET, and total_count is a window over the
-- filtered set, so totalCount / totalPages / hasNextPage describe matches
-- rather than rows.
--
-- Unknown values are ignored rather than rejected: an older app build must keep
-- working against a newer deployment and vice versa. The one exception is an
-- unknown category, which raises P0002 so the endpoint can answer 404 — that
-- was already the contract on books-list and the app depends on it.
--
-- SECURITY INVOKER, so books_public_read_published still decides visibility.
-- The explicit is_published predicate is for the planner and for service_role.
-- -----------------------------------------------------------------------------

create or replace function public.catalog_books(
  p_query text default null,
  p_category text default null,
  p_premium boolean default null,
  p_min_rating numeric default null,
  p_languages text[] default null,
  p_lengths text[] default null,
  p_sort text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  title text,
  author_name text,
  author_id uuid,
  cover_path text,
  cover_color text,
  cover_color_dark text,
  rating numeric,
  tag text,
  genre text,
  read_time_minutes integer,
  price_cents integer,
  currency text,
  format text,
  is_premium boolean,
  published_at timestamptz,
  language text,
  page_count integer,
  length_bucket text,
  total_count bigint
)
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_category text := nullif(trim(coalesce(p_category, '')), '');
  v_category_id uuid;
  v_tsquery tsquery;
  v_like text;
  v_sort text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_category is not null then
    if v_category ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select c.id into v_category_id from public.categories c where c.id = v_category::uuid;
    else
      select c.id into v_category_id from public.categories c where c.slug = v_category;
    end if;

    if v_category_id is null then
      raise exception 'Category not found' using errcode = 'P0002';
    end if;
  end if;

  -- Relevance is only meaningful with a search term, so it is the default when
  -- there is one and unavailable when there is not.
  v_sort := lower(coalesce(nullif(trim(coalesce(p_sort, '')), ''), 'default'));
  if v_sort not in ('newest', 'rating', 'title', 'relevance') then
    v_sort := 'default';
  end if;
  if v_sort = 'default' then
    v_sort := case when v_query is null then 'newest' else 'relevance' end;
  end if;
  if v_sort = 'relevance' and v_query is null then
    v_sort := 'newest';
  end if;

  if v_query is not null then
    -- Every token is reduced to word characters before it reaches to_tsquery,
    -- so a query containing tsquery operators is data, not syntax. [:alnum:]
    -- is locale-aware, so Urdu script survives.
    select to_tsquery('simple', string_agg(w.token || ':*', ' & '))
    into v_tsquery
    from (
      select t.token
      from regexp_split_to_table(
        regexp_replace(lower(v_query), '[^[:alnum:]_]+', ' ', 'g'),
        '\s+'
      ) as t(token)
      where t.token <> ''
    ) w;

    -- Trigram fallback, for the substring and misspelling cases a prefix
    -- tsquery cannot reach, and for author names (which are on `authors`, so
    -- they are not in the books search vector at all).
    v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with filtered as (
    select
      b.id,
      b.slug,
      b.title,
      a.name as author_name,
      a.id as author_id,
      b.cover_path,
      b.cover_color,
      b.cover_color_dark,
      b.rating,
      b.tag,
      b.genre,
      b.read_time_minutes,
      b.price_cents,
      b.currency,
      b.format,
      b.is_premium,
      b.published_at,
      b.language,
      b.page_count,
      public.book_length_bucket(b.page_count, b.read_time_minutes) as length_bucket,
      case
        when v_tsquery is null then 0::real
        else ts_rank(b.search_vector_simple, v_tsquery)
      end as rank
    from public.books b
    join public.authors a on a.id = b.author_id
    where b.is_published = true
      and (
        v_category_id is null
        or exists (
          select 1 from public.book_categories bc
          where bc.book_id = b.id and bc.category_id = v_category_id
        )
      )
      and (p_premium is null or b.is_premium = p_premium)
      -- An unrated book carries rating 0, so any minRating above 0 drops it
      -- without needing a separate "is rated" test.
      and (p_min_rating is null or b.rating >= p_min_rating)
      and (p_languages is null or b.language = any (p_languages))
      and (
        p_lengths is null
        or public.book_length_bucket(b.page_count, b.read_time_minutes) = any (p_lengths)
      )
      and (
        v_query is null
        or (v_tsquery is not null and b.search_vector_simple @@ v_tsquery)
        or (
          length(v_query) >= 3
          and (b.title ilike v_like escape '\' or a.name ilike v_like escape '\')
        )
      )
  )
  select
    f.id,
    f.slug,
    f.title,
    f.author_name,
    f.author_id,
    f.cover_path,
    f.cover_color,
    f.cover_color_dark,
    f.rating,
    f.tag,
    f.genre,
    f.read_time_minutes,
    f.price_cents,
    f.currency,
    f.format,
    f.is_premium,
    f.published_at,
    f.language,
    f.page_count,
    f.length_bucket,
    count(*) over () as total_count
  from filtered f
  order by
    case when v_sort = 'relevance' then f.rank end desc nulls last,
    case when v_sort = 'rating' then f.rating end desc nulls last,
    case when v_sort = 'title' then f.title end asc nulls last,
    case when v_sort = 'newest' then f.published_at end desc nulls last,
    -- Every sort ends on the same deterministic tie-break, so a book cannot
    -- appear on two pages or fall between them while the reader scrolls.
    f.published_at desc nulls last,
    f.id desc
  limit v_limit
  offset v_offset;
end;
$fn$;

comment on function public.catalog_books(
  text, text, boolean, numeric, text[], text[], text, integer, integer
) is
  'Filtered, sorted, paginated catalogue. Backs books-list and books-search. Filters apply before LIMIT so total_count describes matches.';

revoke all on function public.catalog_books(
  text, text, boolean, numeric, text[], text[], text, integer, integer
) from public;
grant execute on function public.catalog_books(
  text, text, boolean, numeric, text[], text[], text, integer, integer
) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Language backfill
--
-- Evidence, not a blanket guess. Nineteen of the twenty titles are Urdu — the
-- transliterated ones ("Jannat Ki Talash", "Janooniyat") included, which is
-- exactly the case the app's title-script heuristic got wrong.
--
-- "Muhammad His Conduct and Character" (Adil Salahi) is an English-language
-- work and is marked as such; a blanket 'urdu' would have mislabelled it.
--
-- Scoped to rows that are still NULL, so re-running never overwrites an admin.
-- -----------------------------------------------------------------------------

update public.books
set language = 'english'
where language is null
  and slug in ('muhammad-his-conduct-and-character');

update public.books
set language = 'urdu'
where language is null
  and slug in (
    'jannat-ki-talash',
    'janooniyat',
    'kar-chalay-hum-jaan-nisar',
    'katib-e-bakht-ke-isharay-par',
    'khushbu-rang-aur-mohabbat',
    'kun',
    'laa',
    'maa-ul-malook',
    'majhoor-e-ishq',
    'man-gunjal',
    'qafs-al-rooh',
    'sard-sehra',
    'shaka',
    'talash-e-hind',
    'tu-ay-mere-charah-gar',
    'udhal',
    'urdu-novel-ki-tareekh',
    'wo-jo-karz-tha',
    'woh-aik-kiran'
  );
