# API endpoint plan

This project is built on Supabase + PostgreSQL, so most app endpoints will either map to:

- Supabase table queries with RLS
- Edge Functions for privileged logic
- RPCs for admin or deep business actions

## Public endpoints

The Edge Function endpoint base is `/functions/v1/...`.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/home-feed` | GET | Public | Hero content, featured shelves, and quick catalog cards |
| `/functions/v1/books-list` | GET | Public | Paginated published books |
| `/functions/v1/book-detail?id=<bookId>` | GET | Public | Book detail with author and metadata |
| `/functions/v1/books-search?q=<query>` | GET | Public | Search by text using the Postgres full-text index |
| `/functions/v1/categories-list` | GET | Public | Browse categories |
| `/functions/v1/collections-list` | GET | Public | Returns collections and shelves |
| `/functions/v1/plans-list` | GET | Public | Plan catalog for premium screen |

## Authenticated endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/profile-read` | GET | User | Read profile |
| `/functions/v1/profile-update` | PUT | User | Edit profile |
| `/functions/v1/reading-progress` | GET/POST | User | Fetch and save progress |
| `/functions/v1/wishlist-list` | GET | User | List saved books |
| `/functions/v1/wishlist-toggle` | POST | User | Save or remove favorite books |
| `/functions/v1/downloads-list` | GET | User | Download metadata and history |
| `/functions/v1/downloads-create` | POST | User | Record a completed download |
| `/functions/v1/highlights-list` | GET | User | User notes / highlights |
| `/functions/v1/highlights-upsert` | POST | User | Upsert note data |
| `/functions/v1/library-overview` | GET | User | Combined shelves for saved, read, downloaded items |
| `/functions/v1/entitlements-status` | GET | User | Current premium state |
| `/functions/v1/get-signed-pdf` | POST | User | Signed PDF URL for premium or allowed access |

## Admin endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/admin-books` | GET | Admin | Catalog admin list with counts |
| `/functions/v1/admin-book-update` | PATCH | Admin | Update metadata, publish state, premium state |
| `/functions/v1/admin-categories` | GET | Admin | Category management data |
| `/functions/v1/admin-collections` | GET | Admin | Collection membership/admin list |
| `/functions/v1/admin-users` | GET | Admin | User directory and dashboards |
| `/functions/v1/admin-analytics` | GET | Admin | Top books, reads, downloads, signups |
| `/functions/v1/admin-settings` | GET/PATCH | Admin | Product flags and app config |

## Rules for implementation

- Public catalog reads should stay lightweight and paginated.
- Authenticated user endpoints should use `auth.uid()` and row-level policies.
- Admin endpoints should validate `is_admin()` and use RPCs when possible.
- Large or expensive list queries should use page + pageSize and a stable sort key.
- Premium-only actions should run through Edge Functions, not client-side trust.

## Configured function map

The functions registry is centralized in `supabase/functions/_shared/endpoint-manifest.ts`, and the runtime function toggles are listed in `supabase/config.toml`.

This gives the project a shared contract for future endpoint implementations and keeps the app backend consistent.
