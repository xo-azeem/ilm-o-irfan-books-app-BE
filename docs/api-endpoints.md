# API endpoint plan

This project is built on Supabase + PostgreSQL, so most app endpoints will either map to:

- Supabase table queries with RLS
- Edge Functions for privileged logic
- RPCs for admin or deep business actions

## Public endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/home` | GET | Public | Hero content, featured shelves, and quick catalog cards |
| `/books` | GET | Public | Paginated published books |
| `/books/:id` | GET | Public | Book detail with author and metadata |
| `/books/search` | GET | Public | Search by title, tag, genre, author |
| `/categories` | GET | Public | Browse categories |
| `/collections` | GET | Public | Returns collections and shelves |
| `/plans` | GET | Public | Plan catalog for premium screen |

## Authenticated endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/profile` | GET/PUT | User | Read and edit profile |
| `/reading-progress` | GET/POST | User | Fetch and save progress |
| `/wishlist` | GET/POST | User | Save or remove favorite books |
| `/downloads` | GET/POST | User | Download metadata and history |
| `/highlights` | GET/POST | User | User notes / highlights |
| `/library` | GET | User | Combined shelves for saved, read, downloaded items |
| `/entitlements` | GET | User | Current premium state |
| `/pdf/signed` | POST | User | Signed PDF URL for premium or allowed access |

## Admin endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/admin/books` | GET | Admin | Catalog admin list with counts |
| `/admin/books/:id` | PATCH | Admin | Update metadata, publish state, premium state |
| `/admin/categories` | GET | Admin | Category management data |
| `/admin/collections` | GET | Admin | Collection membership/admin list |
| `/admin/users` | GET | Admin | User directory and dashboards |
| `/admin/analytics` | GET | Admin | Top books, reads, downloads, signups |
| `/admin/settings` | GET/PATCH | Admin | Product flags and app config |

## Rules for implementation

- Public catalog reads should stay lightweight and paginated.
- Authenticated user endpoints should use `auth.uid()` and row-level policies.
- Admin endpoints should validate `is_admin()` and use RPCs when possible.
- Large or expensive list queries should use page + pageSize and a stable sort key.
- Premium-only actions should run through Edge Functions, not client-side trust.

## Configured function map

The functions registry is centralized in `supabase/functions/_shared/endpoint-manifest.ts`, and the runtime function toggles are listed in `supabase/config.toml`.

This gives the project a shared contract for future endpoint implementations and keeps the app backend consistent.
