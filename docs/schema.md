# Database schema

PostgreSQL schema for Ilm o Irfan, designed for Supabase (RLS + Auth + Storage paths).

## ER overview

```text
auth.users 1──1 profiles
profiles 1──* reading_progress *──1 books
profiles 1──* wishlist         *──1 books
profiles 1──* downloads        *──1 books
profiles 1──* highlights       *──1 books
profiles 1──1 reading_streaks
profiles 1──1 entitlements *──? plans

authors 1──* books
books *──* categories   (book_categories)
books *──* collections  (collection_books)

books.cover_path → Storage covers/
books.pdf_path   → Storage pdfs/
```

## Design choices (performance + scale)

| Choice | Why |
| --- | --- |
| UUID primary keys | Safe for distributed clients / offline-friendly inserts later |
| `authors` normalized | Avoids string drift; FE still gets `author_name` via join/view |
| `price_cents` + `currency` | Avoid float money bugs; FE formats for display |
| `progress` as `0–1` | Matches FE `ReadingBook.progress` |
| `search_vector` + `pg_trgm` | Fast catalog search without Redis |
| Lean views (`book_list_items`) | Home/Search payloads skip heavy description/PDF fields when queried via view |
| `downloads` metadata only | PDF bytes stay in Storage / device FS |
| `entitlements` no client writes | Only service role / RevenueCat webhook |
| Partial indexes on published books | Smaller indexes for catalog reads |
| Collections `kind` | `hero` / `shelf` / `carousel` maps cleanly to Home UI |

## Tables (summary)

### Catalog

- **authors** — `slug`, `name`, `bio`, `avatar_path`
- **books** — title, description, author FK, genre, rating, price, cover/pdf paths, colors, tags, `is_premium`, `is_published`, FTS vector
- **categories** — explore chips (`icon_key`, accents)
- **book_categories** — M:N
- **collections** — curated shelves / hero
- **collection_books** — ordered membership

### Users & library

- **profiles** — `id = auth.users.id`, contact + address fields, `role` (`user` | `admin`). Guest/subscriber are **not** stored here (anon session vs `entitlements`).
- **reading_progress** — page, fraction, chapter label, `last_read_at`
- **wishlist** — saved books
- **downloads** — status + size metadata
- **highlights** — optional notes
- **reading_streaks** — day streak for profile stats

### Subscriptions

- **plans** — Premium definition + RevenueCat product id + features JSON
- **entitlements** — active/expired status, expiry, RC ids, store

## FE field mapping

| FE (camelCase) | Column / source |
| --- | --- |
| `author` | `authors.name` / `book_list_items.author_name` |
| `coverColor` | `cover_color` |
| `coverColorDark` | `cover_color_dark` |
| `readTime` | format `read_time_minutes` |
| `price` | `price_cents / 100` |
| `memberSince` | format `profiles.created_at` |
| `fullName` | `full_name` |
| `size` | format `file_size_bytes` |
| `progress` | `reading_progress.progress` |
| `chapter` | `chapter_label` |

## RLS summary

| Area | Policy |
| --- | --- |
| Published catalog + active plans | `SELECT` for `anon` + `authenticated` |
| `profiles` | read/update own contact fields; `role` is not client-writable |
| progress / wishlist / downloads / highlights / streaks | CRUD own rows |
| `entitlements` | `SELECT` own (admins may `SELECT` all); writes via service role |
| Catalog writes + unpublished reads | `authenticated` + `is_admin()` (JWT `app_metadata.app_role`) |
| Storage `covers` / `pdfs` writes | admin JWT only; PDFs still have no client SELECT |

## Applying schema

- Supabase migrations: `supabase/migrations/`
- pgAdmin one-shot: `sql/pgadmin/01_full_schema.sql`, `03_harden_grants_rls_indexes.sql`, `04_admin_roles.sql`, then `02_seed.sql`

See [setup-guide.md](./setup-guide.md) for connection steps.
