# API endpoint plan

This project is built on Supabase + PostgreSQL, so most app endpoints will either map to:

- Supabase table queries with RLS
- Edge Functions for privileged logic
- RPCs for admin or deep business actions

## Public endpoints

The Edge Function endpoint base is `/functions/v1/...`.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/home-feed` | GET | Public | Collections, categories, newest books, plus `shelves.hero` / `trending` / `newArrivals` and `featuredCollectionId` |
| `/functions/v1/books-list` | GET | Public | Paginated published books |
| `/functions/v1/book-detail?id=<bookId>` | GET | Public | Book detail with author and metadata |
| `/functions/v1/books-search?q=<query>` | GET | Public | Search by text using the Postgres full-text index |
| `/functions/v1/categories-list` | GET | Public | Browse categories |
| `/functions/v1/collections-list` | GET | Public | Returns collections and shelves |
| `/functions/v1/plans-list` | GET | Public | Plan catalog for premium screen |

## Authenticated endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/profile-read` | GET | User | Own profile + `streak` (`current_streak`, `longest_streak`, `last_read_date`) |
| `/functions/v1/profile-update` | PUT/PATCH | User | Partial contact fields including `date_of_birth` (YYYY-MM-DD); email/role not writable |
| `/functions/v1/reading-progress` | GET/POST | User | Fetch and save progress |
| `/functions/v1/wishlist-list` | GET | User | List saved books |
| `/functions/v1/wishlist-toggle` | POST | User | Save or remove favorite books |
| `/functions/v1/downloads-list` | GET | User | Download metadata and history |
| `/functions/v1/downloads-create` | POST | User | Record a completed download |
| `/functions/v1/highlights-list` | GET | User | User notes / highlights |
| `/functions/v1/highlights-upsert` | POST | User | Upsert note data |
| `/functions/v1/highlights-delete` | POST | User | Delete one highlight by id |
| `/functions/v1/library-overview` | GET | User | Combined shelves: wishlist, in-progress, finished (`progress >= 0.99`), downloads, highlights |
| `/functions/v1/entitlements-status` | GET | User | Current premium state |
| `/functions/v1/get-signed-pdf` | POST | User | Signed PDF URL for premium or allowed access |

## Admin endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/admin-books` | GET | Admin | Catalog admin list with counts |
| `/functions/v1/admin-book-update` | PATCH | Admin | Update metadata, publish state, premium state |
| `/functions/v1/admin-book-create` | POST | Admin | Create book (`title` + `authorId` required; slug optional) |
| `/functions/v1/admin-authors` | GET | Admin | Paginated author CMS rows |
| `/functions/v1/admin-author-create` | POST | Admin | Create author |
| `/functions/v1/admin-author-update` | PATCH | Admin | Update author |
| `/functions/v1/admin-author-delete` | POST | Admin | Delete author (fails if books remain) |
| `/functions/v1/admin-book-delete` | POST | Admin | Delete books; returns cover/pdf paths to purge |
| `/functions/v1/admin-bulk-update-books` | POST | Admin | Bulk publish / premium |
| `/functions/v1/admin-set-book-relations` | POST | Admin | Set category + collection membership for a book |
| `/functions/v1/admin-set-collection-books` | POST | Admin | Replace ordered books in a collection |
| `/functions/v1/admin-reorder` | POST | Admin | Reorder categories or collections |
| `/functions/v1/admin-set-entitlement` | POST | Admin | Comp / adjust entitlement (promotional) |
| `/functions/v1/admin-set-user-role` | POST | Admin | Promote / demote admin |
| `/functions/v1/admin-user-detail` | GET | Admin | `?id=` user detail payload |
| `/functions/v1/admin-storage-audit` | GET | Admin | Orphans + broken book paths |
| `/functions/v1/admin-delete-storage-object` | POST | Admin | Delete orphan cover/pdf |
| `/functions/v1/admin-dashboard-stats` | GET | Admin | CMS dashboard counters |
| `/functions/v1/admin-categories` | GET | Admin | Category management data |
| `/functions/v1/admin-collections` | GET | Admin | Collection membership/admin list |
| `/functions/v1/admin-users` | GET | Admin | User directory and dashboards |
| `/functions/v1/admin-analytics` | GET | Admin | Top books, reads, downloads, signups |
| `/functions/v1/admin-settings` | GET/PATCH | Admin | Product flags and app config |

## Webhooks

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/revenuecat-webhook` | POST | Shared secret (`REVENUECAT_WEBHOOK_AUTH`) | Idempotent entitlement sync |

Requires `event.id` (UUID), `app_user_id` (Supabase Auth UUID), `type`, and `event_timestamp_ms`.
Duplicates return `200` with `data.duplicate`; stale events return `200` with `data.stale`.

## Deprecated

| Endpoint | Status | Use instead |
| --- | --- | --- |
| `/functions/v1/signed-pdf` | `410 DEPRECATED_ENDPOINT` | `/functions/v1/get-signed-pdf` |

## Response envelope

```jsonc
{ "data": { } }                                  // single object
{ "data": [ ], "page": 1, "pageSize": 20,        // list
  "totalCount": 121, "totalPages": 7,
  "hasNextPage": true, "hasPreviousPage": false }
{ "error": { "code": "...", "message": "..." } } // any failure
```

Branch on `error.code`. Messages are for logs and may be reworded without notice. Postgres
errors are logged server-side and never returned to the client.

### Shared error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | Missing or invalid `Authorization` header |
| `FORBIDDEN` | 403 | Authenticated but not an admin |
| `INVALID_REQUEST` | 400 | Bad or missing field; message names the field |
| `NOT_FOUND` | 404 | Target row does not exist or is not published |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP verb; message lists the allowed ones |
| `UNEXPECTED_ERROR` | 500 | Unhandled failure — check the function logs |

### Endpoint-specific codes

| Code | Status | Endpoint |
| --- | --- | --- |
| `PREMIUM_REQUIRED` | 403 | `get-signed-pdf` — premium book, no active entitlement |
| `PDF_NOT_AVAILABLE` | 404 | `get-signed-pdf` — book has no `pdf_path` |
| `PDF_NOT_IN_STORAGE` | 404 | `get-signed-pdf` — `pdf_path` set but object missing |
| `DEPRECATED_ENDPOINT` | 410 | `signed-pdf` |
| `WEBHOOK_AUTH_FAILED` | 401 | `revenuecat-webhook` — bad Authorization |
| `INVALID_WEBHOOK_EVENT` | 400 | `revenuecat-webhook` — missing/invalid id, user, type, or timestamp |
| `USER_NOT_FOUND` | 400 | `revenuecat-webhook` — no profile for `app_user_id` |
| `WEBHOOK_CONFIG_ERROR` | 500 | `revenuecat-webhook` — secret not configured |

## Premium access

Access to a PDF through `get-signed-pdf` is granted when **any** of the following is true:

1. `profiles.role = 'admin'` (or JWT `app_metadata.app_role = 'admin'`) — admins read any
   PDF, published or draft, with no subscription.
2. The book is **free** (`books.is_premium = false`) and published — any signed-in user.
3. The book is **premium** (`is_premium = true`) and the user has an active entitlement
   (`status = 'active'` and `expires_at` null or in the future).
Those three are the whole list. There is no global override: the
`ALLOW_PDF_WITHOUT_ENTITLEMENT` env flag and the
`app_settings.allow_pdf_without_entitlement` column are no longer read by
`get-signed-pdf`, so the only way to open a premium book is an entitlement.

`PREMIUM_REQUIRED` is returned only for **premium** books when the caller is not an admin
and holds no active entitlement.

`entitlements-status` reports:

```jsonc
{ "data": {
    "isActive": false,          // the subscription alone
    "isAdmin": true,            // profiles.role or the app_role JWT claim
    "canAccessPremium": true,   // isActive || isAdmin  <- gate premium UI on this
    "entitlement": null } }
```

Gating on `isActive` alone would show an admin a locked button on a file the backend would
serve them. Free books do not need `canAccessPremium` to open.

## Request notes

- **Partial updates.** `profile-update`, `admin-settings`, `admin-book-update` and
  `highlights-upsert` write only the keys present in the body. Send an explicit `null` to
  clear a field; an empty body returns 400.
- **Both key styles.** `snake_case` and `camelCase` are accepted (`full_name` / `fullName`).
- **Reading progress.** Send `progress` (0–1) *or* `progress_percent` (0–100), never both.
- **Pagination.** `page` / `pageSize` (`limit` is an alias). `pageSize` is capped at 100.

## Rules for implementation

- Public catalog reads should stay lightweight and paginated.
- Authenticated user endpoints should use `auth.uid()` and row-level policies.
- Admin endpoints should validate `is_admin()` and use RPCs when possible.
- Large or expensive list queries should use page + pageSize and a stable sort key.
- Premium-only actions should run through Edge Functions, not client-side trust.

## Configured function map

The functions registry is centralized in `supabase/functions/_shared/endpoint-manifest.ts`, and the runtime function toggles are listed in `supabase/config.toml`.

This gives the project a shared contract for future endpoint implementations and keeps the app backend consistent.
