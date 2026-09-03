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
- **entitlements** — active/expired status, expiry, RC ids, store, `last_revenuecat_event_id` / `last_revenuecat_event_at`
- **revenuecat_events** — webhook idempotency ledger (service role only; unique event id)
- **app_settings** — singleton product flags (maintenance, sign-ups, featured collection). `allow_pdf_without_entitlement` is retained but unread: nothing consults it, and PDF access follows the admin role, `books.is_premium` and the entitlement alone.

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
| `revenuecat_events` | No client access; service role / webhook only |
| `app_settings` | `SELECT` for anon + authenticated; `UPDATE` for `is_admin()` only |
| Catalog writes + unpublished reads | `authenticated` + `is_admin()` (JWT `app_metadata.app_role`) |
| Storage `covers` / `pdfs` writes | admin JWT only; PDFs still have no client SELECT |
| `admin_audit_log` | `SELECT` for `is_admin()`; rows written only by SECURITY DEFINER triggers |
| library tables (progress / downloads / wishlist / highlights / streaks) | own rows, **plus** `SELECT` all for `is_admin()` |
| `plans` | public `SELECT` of active plans; full write for `is_admin()` |

## Admin CMS (v2)

`20260830120000_admin_cms_v2.sql` adds the production CMS surface.

### Tables and columns

- **admin_audit_log** — actor, action, entity, and changed keys with before/after values. Written by
  `private.audit_write()` triggers on `books`, `authors`, `categories`, `collections`, `plans`,
  `app_settings`, and on `profiles.role` changes only (self-edits are not logged).
- **app_settings** — new flags: `maintenance_mode`, `maintenance_message`, `signup_enabled`,
  `min_supported_version`, `support_email`, `featured_collection_id`.
- **books** — `published_at` is now stamped by the `books_stamp_published_at` trigger (set on the
  first publish, cleared on unpublish), so clients must stop sending it. A `NOT VALID` check
  constraint also blocks publishing a title that has no `pdf_path`.

### Views

| View | Purpose |
| --- | --- |
| `admin_book_rows` | One row per book with author name, `category_ids`, `collection_ids`, and reader / download / wishlist counts |
| `admin_author_rows` | Authors with book and published counts |
| `admin_category_rows` | Categories with book counts |
| `admin_collection_rows` | Collections with membership counts |
| `admin_user_directory` | Rebuilt: adds `is_subscriber`, reading and download counts, `last_read_at` |

All are `security_invoker`, so admin RLS still applies.

### RPCs (all guarded by `is_admin()`)

| Function | Purpose |
| --- | --- |
| `admin_bulk_update_books(ids, is_published, is_premium)` | Batch publish / premium; skips titles with no PDF |
| `admin_delete_books(ids)` | Deletes rows and returns the storage paths to purge |
| `admin_set_book_relations(book, categories, collections)` | Replaces a book's joins in one call |
| `admin_set_collection_books(collection, ordered_ids)` | Replaces membership, preserving order |
| `admin_reorder(table, ids)` | Persists a `sort_order` reorder for categories or collections |
| `admin_set_entitlement(user, status, plan, expires_at)` | Comps and support fixes; marks `store = 'promotional'` |
| `admin_user_detail(user)` | Profile, streak, recent reading, downloads, and counts |
| `admin_analytics(days)` | Day-bucketed signups / reads / downloads, top books and categories |
| `admin_storage_audit()` | Unreferenced storage objects and books pointing at missing files |
| `admin_delete_storage_object(bucket, name)` | Deletes an orphan; refuses if a book still references it |
| `admin_dashboard_stats()` | Extended with catalog, plan, and 7-day activity counters |

RevenueCat still owns store purchases — a webhook event overwrites a manual `admin_set_entitlement`
grant, which is why that grant is labelled promotional.

## Applying schema

- **Canonical:** `supabase/migrations/` via `npm run db:push` (preferred for staging/production)
- pgAdmin exploration only (not production source of truth), in order:
  `01_full_schema.sql` → `03_harden_grants_rls_indexes.sql` → `04_admin_roles.sql` →
  `06_app_settings.sql` → `07_admin_cms_v2.sql` → `08_search_views_and_admin_fixes.sql` →
  `09_revenuecat_events_idempotency.sql` → `10_lock_reading_streaks.sql` →
  `02_seed.sql` (and optionally `05_remove_dummy_seed_books.sql` if old dummy rows exist)
- After applying, regenerate typings: `npm run types:generate`
- Hosted deploy steps: [`docs/ops/deploy-checklist.md`](./ops/deploy-checklist.md)

See [setup-guide.md](./setup-guide.md) for connection steps.
