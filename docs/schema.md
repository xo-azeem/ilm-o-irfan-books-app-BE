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

- **profiles** — `id = auth.users.id`, contact + address fields, `role` (`user` | `admin`), `monthly_goal` (1–100, default 4). Guest/subscriber are **not** stored here (anon session vs `entitlements`).
- **reading_progress** — page, fraction, chapter label, `last_read_at`, `finished_at` (server-set once at `progress >= 0.99`, never cleared)
- **wishlist** — saved books
- **downloads** — status + size metadata
- **highlights** — optional notes
- **reading_streaks** — day streak for profile stats, maintained by `private.record_reading_activity()` (local day of `last_read_at`; UTC without a zone)
- **reading_days** — one row per (user, local day): `pages_read`, `sessions`, `night_sessions`. Same trigger; owner SELECT only
- **achievements** — `(user_id, achievement_id, earned_at)`, insert-only via `private.award_achievements()`; owner SELECT only

### Subscriptions

- **plans** — Premium definition + RevenueCat product id + features JSON
- **entitlements** — active/expired status, expiry, RC ids, store, `last_revenuecat_event_id` / `last_revenuecat_event_at`
- **revenuecat_events** — webhook idempotency ledger (service role only; unique event id)
- **app_settings** — singleton product flags (maintenance, sign-ups, featured collection). `allow_pdf_without_entitlement` has been **dropped**: it was already unread, and a dormant column that means "serve paid content to everyone" is a liability. PDF access follows the admin role and the entitlement alone — `books.is_premium` does not enter into it.

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
| Storage `covers` / `pdfs` writes | admin JWT only |
| Storage reads | No client SELECT policy on `covers` or `pdfs`. `covers` renders through the public bucket URL, which never consults RLS; `pdfs` is reachable only via `get-signed-pdf`. `avatars` keeps an owner-scoped SELECT because that bucket is private |
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
| `admin_collection_rows` | Collections with `book_count` (all members), `published_count` and `is_system` |
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

## Release hardening

`20260905120000_release_hardening.sql` closes the gaps from the pre-release audit.

### Storage-aware publishing

| Function | Purpose |
| --- | --- |
| `storage_object_key(bucket, path)` | Normalises a stored path to a Storage key — strips a leading slash and an optional bucket prefix, so `pdfs/x.pdf`, `/pdfs/x.pdf` and `x.pdf` all resolve to the same object |
| `storage_object_exists(bucket, path)` | `SECURITY DEFINER` boolean over `storage.objects`; answers one question rather than exposing the listing |
| `book_publish_blocker(book_id)` | `NOT_FOUND`, `PDF_PATH_MISSING`, `PDF_NOT_IN_STORAGE`, or null when the title is safe to publish |

`books_published_needs_pdf` only ever checked that `pdf_path` was non-empty, so a typo
published a title whose readers hit `PDF_NOT_IN_STORAGE`. `admin_bulk_update_books` now runs
`book_publish_blocker()` per id and returns `skippedBooks: [{ id, reason }]` instead of
silently counting them; `admin-book-create` and `admin-book-update` run the same check
before flipping `is_published`.

### Reading progress

`upsert_reading_progress(book_id, current_page, total_pages, progress, chapter_label, client_updated_at, tz)` —
`security invoker`, writes only `auth.uid()`'s row. Null means "leave this column alone" and
`''` clears `chapter_label`, so a partial sync cannot reset a reader to page 1. The merge is
one `INSERT ... ON CONFLICT DO UPDATE`, so two devices syncing at once cannot interleave the
way a read-then-write would. `tz` (IANA name or `+HH:MM`) is passed to the streak trigger
through the transaction-local setting `app.reading_tz`.

`reading_record(tz)` — `security definer`, scoped to `auth.uid()`: the profile screen's
`readingGoal`, `streak.recent_days` (seven days ending today in `tz`) and the four
`achievements`, in one call.

### Search limits

`search_books()` clamps `p_limit` to 1–100 and `p_offset` to 0–10,000 inside the function.
The Edge Function already capped page size, but the RPC is granted to `anon` and is callable
directly through the Data API.

### Audit attribution

The admin functions write with the service-role key, which carries no `auth.uid()`, so every
CMS change used to be logged as `system`. `private.audit_write()` now falls back to the
`x-audit-actor-id` / `x-audit-actor-email` request headers, and only on a `service_role`
request — no client role can reach that branch, and none holds a write grant on an audited
table. `requireAdmin()` sets those headers from the verified JWT.

### Category / collection / plan CRUD

| Function | Guard |
| --- | --- |
| `admin_upsert_category(id, label, slug, icon_key, accent, accent_dark, sort_order)` | `is_admin()`; slug derived from label when omitted |
| `admin_delete_category(id, force)` | Refuses while any book uses it (`23503`) |
| `admin_upsert_collection(id, title, slug, subtitle, accent, kind, sort_order, is_published)` | `is_admin()`; validates `kind` |
| `admin_delete_collection(id, force)` | Refuses the featured collection |
| `admin_upsert_plan(id, code, name, price_cents, currency, interval, features, revenuecat_product_id, is_active, sort_order)` | `is_admin()`; validates interval and price |
| `admin_delete_plan(id, force)` | Refuses while entitlements reference it |

These are called with the **caller's JWT**, not the service-role key, so `is_admin()` sees
the real user and the audit trigger records them without needing the header fallback.

`admin_plan_rows` is the matching view: every plan including inactive ones, with an
entitlement count. `plans_public_read_active` hides those from `plans-list` by design.

## The last-admin guard actually guards now

`20260905130000_fix_last_admin_guard.sql`. `admin_set_user_role()` declared its local
variable as `current_role`, which is a **reserved SQL keyword**: inside the function body
Postgres parses it as the built-in session role, never as the variable. Both guards that
read it were therefore dead code, so the last admin could be demoted — locking everyone out
of the CMS with no way back except raw SQL — and setting a role on a user id that does not
exist reported success while updating nothing.

Reproduce it on any database before this migration:

```sql
do $$
declare current_role text;
begin
  select 'admin' into current_role;
  raise notice '%', current_role;   -- prints the session role, not 'admin'
end
$$;
```

Renaming to `v_current_role` is the whole fix; the surrounding logic was already correct.
`found` now drives the existence check, so the function no longer relies on a sentinel.
`admin-set-user-role` maps the guard to `409 LAST_ADMIN`.

### Indexes added

`entitlements(plan_id)`, `book_categories(category_id)`, `collection_books(book_id)` — each
is a foreign key that Postgres does not index for you and that the new delete guards scan.

## Applying schema

- **Canonical:** `supabase/migrations/` via `npm run db:push` (preferred for staging/production)
- pgAdmin exploration only (not production source of truth), in order:
  `01_full_schema.sql` → `03_harden_grants_rls_indexes.sql` → `04_admin_roles.sql` →
  `06_app_settings.sql` → `07_admin_cms_v2.sql` → `08_search_views_and_admin_fixes.sql` →
  `09_revenuecat_events_idempotency.sql` → `10_lock_reading_streaks.sql` →
  `11_release_hardening.sql` →
  `02_seed.sql` (and optionally `05_remove_dummy_seed_books.sql` if old dummy rows exist)
- After applying, regenerate typings: `npm run types:generate`
- Hosted deploy steps: [`docs/ops/deploy-checklist.md`](./ops/deploy-checklist.md)

See [setup-guide.md](./setup-guide.md) for connection steps.
