-- =============================================================================
-- Ilm o Irfan — initial schema
-- Scalable catalog + library + subscriptions for Supabase Postgres
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

-- -----------------------------------------------------------------------------
-- Catalog: authors
-- -----------------------------------------------------------------------------

create table public.authors (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  bio text,
  avatar_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint authors_slug_unique unique (slug),
  constraint authors_name_not_blank check (length(trim(name)) > 0)
);

create trigger authors_set_updated_at
before update on public.authors
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Catalog: books
-- -----------------------------------------------------------------------------

create table public.books (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  description text not null default '',
  author_id uuid not null references public.authors (id) on delete restrict,
  genre text,
  rating numeric(2, 1) not null default 0,
  rating_count integer not null default 0,
  price_cents integer not null default 0,
  currency text not null default 'USD',
  format text not null default 'Digital edition',
  cover_path text,
  cover_color text,
  cover_color_dark text,
  pdf_path text,
  file_size_bytes bigint,
  read_time_minutes integer,
  tag text,
  tags text[] not null default '{}',
  is_premium boolean not null default false,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
    || setweight(to_tsvector('english', coalesce(genre, '')), 'C')
    || setweight(to_tsvector('english', coalesce(tag, '')), 'C')
    || setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
  ) stored,
  constraint books_slug_unique unique (slug),
  constraint books_title_not_blank check (length(trim(title)) > 0),
  constraint books_rating_range check (rating >= 0 and rating <= 5),
  constraint books_rating_count_nonneg check (rating_count >= 0),
  constraint books_price_nonneg check (price_cents >= 0),
  constraint books_file_size_nonneg check (file_size_bytes is null or file_size_bytes >= 0),
  constraint books_read_time_nonneg check (read_time_minutes is null or read_time_minutes >= 0)
);

create trigger books_set_updated_at
before update on public.books
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Catalog: categories + junction
-- -----------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  label text not null,
  icon_key text not null default 'book',
  accent text,
  accent_dark text,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint categories_slug_unique unique (slug),
  constraint categories_label_not_blank check (length(trim(label)) > 0)
);

create table public.book_categories (
  book_id uuid not null references public.books (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (book_id, category_id)
);

-- -----------------------------------------------------------------------------
-- Catalog: collections + junction
-- -----------------------------------------------------------------------------

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  subtitle text,
  accent text,
  kind text not null default 'shelf',
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint collections_slug_unique unique (slug),
  constraint collections_kind_check check (kind in ('hero', 'shelf', 'carousel')),
  constraint collections_title_not_blank check (length(trim(title)) > 0)
);

create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

create table public.collection_books (
  collection_id uuid not null references public.collections (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (collection_id, book_id)
);

-- -----------------------------------------------------------------------------
-- Users: profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_path text,
  date_of_birth date,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Personal library
-- -----------------------------------------------------------------------------

create table public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  current_page integer not null default 1,
  total_pages integer,
  progress numeric(5, 4) not null default 0,
  chapter_label text,
  last_read_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint reading_progress_user_book_unique unique (user_id, book_id),
  constraint reading_progress_page_positive check (current_page >= 1),
  constraint reading_progress_total_pages_check check (total_pages is null or total_pages >= 1),
  constraint reading_progress_fraction check (progress >= 0 and progress <= 1)
);

create trigger reading_progress_set_updated_at
before update on public.reading_progress
for each row execute function public.set_updated_at();

create table public.wishlist (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, book_id)
);

create table public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  status text not null default 'completed',
  file_size_bytes bigint,
  downloaded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint downloads_user_book_unique unique (user_id, book_id),
  constraint downloads_status_check check (status in ('pending', 'completed', 'failed')),
  constraint downloads_size_nonneg check (file_size_bytes is null or file_size_bytes >= 0)
);

create trigger downloads_set_updated_at
before update on public.downloads
for each row execute function public.set_updated_at();

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  page_number integer,
  text_excerpt text,
  note text,
  color text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint highlights_page_positive check (page_number is null or page_number >= 1)
);

create trigger highlights_set_updated_at
before update on public.highlights
for each row execute function public.set_updated_at();

create table public.reading_streaks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_read_date date,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint reading_streaks_current_nonneg check (current_streak >= 0),
  constraint reading_streaks_longest_nonneg check (longest_streak >= 0)
);

-- Auth → profile bootstrap (after reading_streaks exists)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      phone = coalesce(excluded.phone, public.profiles.phone),
      updated_at = timezone('utc', now());

  insert into public.reading_streaks (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Subscriptions
-- -----------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  price_cents integer not null,
  currency text not null default 'PKR',
  interval text not null default 'month',
  features jsonb not null default '[]'::jsonb,
  revenuecat_product_id text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint plans_code_unique unique (code),
  constraint plans_interval_check check (interval in ('month', 'year', 'lifetime')),
  constraint plans_price_nonneg check (price_cents >= 0)
);

create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create table public.entitlements (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  status text not null default 'expired',
  starts_at timestamptz,
  expires_at timestamptz,
  revenuecat_app_user_id text,
  revenuecat_entitlement_id text,
  store text,
  raw_event jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint entitlements_status_check check (
    status in ('active', 'expired', 'cancelled', 'grace', 'billing_issue', 'trial')
  ),
  constraint entitlements_store_check check (
    store is null or store in ('app_store', 'play_store', 'stripe', 'promotional', 'unknown')
  )
);

create trigger entitlements_set_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Indexes (performance without Redis)
-- -----------------------------------------------------------------------------

create index books_published_idx on public.books (is_published, published_at desc)
  where is_published = true;

create index books_author_id_idx on public.books (author_id);
create index books_genre_idx on public.books (genre);
create index books_is_premium_idx on public.books (is_premium) where is_published = true;
create index books_rating_idx on public.books (rating desc) where is_published = true;
create index books_search_vector_idx on public.books using gin (search_vector);
create index books_title_trgm_idx on public.books using gin (title gin_trgm_ops);
create index books_tags_gin_idx on public.books using gin (tags);

create index authors_name_trgm_idx on public.authors using gin (name gin_trgm_ops);

create index categories_sort_idx on public.categories (sort_order, label);
create index book_categories_category_idx on public.book_categories (category_id);

create index collections_kind_sort_idx on public.collections (kind, sort_order)
  where is_published = true;
create index collection_books_sort_idx on public.collection_books (collection_id, sort_order);

create index reading_progress_user_last_read_idx
  on public.reading_progress (user_id, last_read_at desc);
create index reading_progress_book_idx on public.reading_progress (book_id);

create index wishlist_user_created_idx on public.wishlist (user_id, created_at desc);
create index downloads_user_downloaded_idx on public.downloads (user_id, downloaded_at desc);
create index highlights_user_book_idx on public.highlights (user_id, book_id);

create index entitlements_status_expires_idx
  on public.entitlements (status, expires_at);
create index entitlements_rc_user_idx
  on public.entitlements (revenuecat_app_user_id)
  where revenuecat_app_user_id is not null;

create index plans_active_sort_idx on public.plans (is_active, sort_order);

-- -----------------------------------------------------------------------------
-- Lean catalog views (Home / Search list payloads)
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
  b.published_at
from public.books b
join public.authors a on a.id = b.author_id
where b.is_published = true;

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
  count(bc.book_id)::integer as book_count
from public.categories c
left join public.book_categories bc on bc.category_id = c.id
left join public.books b on b.id = bc.book_id and b.is_published = true
group by c.id;

create or replace view public.collection_summaries
with (security_invoker = true)
as
select
  col.id,
  col.slug,
  col.title,
  col.subtitle,
  col.accent,
  col.kind,
  col.sort_order,
  count(cb.book_id)::integer as book_count
from public.collections col
left join public.collection_books cb on cb.collection_id = col.id
left join public.books b on b.id = cb.book_id and b.is_published = true
where col.is_published = true
group by col.id;

-- Active premium helper for Edge Functions / RLS
create or replace function public.user_has_active_premium(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = p_user_id
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > timezone('utc', now()))
  );
$$;

revoke all on function public.user_has_active_premium(uuid) from public;
grant execute on function public.user_has_active_premium(uuid) to authenticated, service_role;
