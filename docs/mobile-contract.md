# Mobile API contract (v1)

Frozen contract for the Ilm o Irfan React Native app.  
Backend branch: `feat/mobile-api-parity` · Audit: [`audits/2026-09-06-fe-be-parity.md`](./audits/2026-09-06-fe-be-parity.md)  
Fixtures: [`fixtures/`](./fixtures/) · Inventory: [`../supabase/functions/_shared/endpoint-manifest.ts`](../supabase/functions/_shared/endpoint-manifest.ts)

The API stays **snake_case**. Map to camelCase on the client; do not ask the backend to rename fields.

---

## Envelopes

Every Edge Function returns one of:

```jsonc
{ "data": { /* single object */ } }

{ "data": [ /* … */ ], "page": 1, "pageSize": 20, "totalCount": 121,
  "totalPages": 7, "hasNextPage": true, "hasPreviousPage": false }

{ "error": { "code": "PREMIUM_REQUIRED", "message": "…" } }
```

- Branch on `error.code`, never on `message`.
- Shared codes: `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `INVALID_REQUEST` (400), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `UNEXPECTED_ERROR` (500), `PAGE_OUT_OF_RANGE` (400).
- Auth for user/admin routes: `Authorization: Bearer <access_token>` and `apikey: <anon key>`.

`plans-list` is the list exception: plain `{ "data": [ … ] }` (no page meta).

---

## Screen → route map

| Screen | Method | Route | Auth |
| --- | --- | --- | --- |
| Home | GET | `/functions/v1/home-feed` | Public |
| Search (browse) | GET | `/functions/v1/books-list?page=&pageSize=` | Public |
| Search (category) | GET | `/functions/v1/books-list?category=<uuid-or-slug>` | Public |
| Search (query) | GET | `/functions/v1/books-search?q=` | Public |
| Categories chips | GET | `/functions/v1/categories-list` | Public |
| Collection tap | GET | `/functions/v1/collection-books?id=` or `?slug=` | Public |
| Collections strip | GET | `/functions/v1/collections-list` | Public |
| Book detail | GET | `/functions/v1/book-detail?id=<uuid>` | Public |
| Reader open / download | POST | `/functions/v1/get-signed-pdf` body `{ "bookId" }` | User |
| Progress sync | GET/POST | `/functions/v1/reading-progress` | User |
| Library | GET | `/functions/v1/library-overview` | User |
| Wishlist | GET/POST | `wishlist-list` / `wishlist-toggle` | User |
| Downloads | GET/POST | `downloads-list` / `downloads-create` | User |
| Highlights | GET/POST | `highlights-list` / `highlights-upsert` / `highlights-delete` | User |
| Profile | GET/PUT | `profile-read` / `profile-update` | User |
| Avatar | POST | `avatar-upload-url` then upload then `profile-update` | User |
| Subscription status | GET | `entitlements-status` | User |
| Plan catalog | GET | `plans-list` | Public |
| Login / Sign up / Google | — | Supabase Auth SDK (not an Edge Function) | — |
| Theme / language / notifications | — | MMKV only | — |

Purchases: RevenueCat SDK. Entitlements land via webhook — the app only **reads** `entitlements-status`.

---

## Book card shape

Returned by `books-list`, `books-search`, `home-feed` shelves/books, and `collection-books`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `slug` | string | |
| `title` | string | |
| `author_name` | string \| null | |
| `author_id` | uuid \| null | |
| `cover_path` | string \| null | Storage path |
| `coverUrl` | string \| null | **Ready-to-load public URL** — use this in `<Image>` |
| `cover_color` / `cover_color_dark` | string \| null | Placeholder accents |
| `rating` | number \| null | |
| `tag` | string \| null | |
| `genre` | string \| null | |
| `read_time_minutes` | number \| null | Format on client (`"4 hr read"`) |
| `price_cents` | number | |
| `currency` | string | e.g. `PKR` |
| `format` | string \| null | |
| `is_premium` | boolean | |
| `published_at` | timestamptz \| null | |

`book-detail` adds `description`, `rating_count`, `tags`, `is_published`, nested `author`, and the same `coverUrl`. It does **not** include `pdf_path`.

Library shelves nest a leaner `book` object (also with `coverUrl`):

`id, slug, title, cover_path, coverUrl, cover_color, cover_color_dark, genre, is_premium, read_time_minutes, author: { name }`

---

## Cover URL rule

- Bucket `covers` is public. The backend sets `coverUrl` from `cover_path`.
- Path forms `covers/slug.webp`, `/covers/slug.webp`, and `slug.webp` all resolve.
- If `cover_path` is null/empty → `coverUrl` is null → show color placeholder.
- Do **not** invent Storage URLs on the client. Do **not** list the covers bucket.

---

## Field map (FE mock → API)

| FE mock | API |
| --- | --- |
| `author` | `author_name` or `author.name` |
| `coverColor` / `coverColorDark` | `cover_color` / `cover_color_dark` |
| cover image | `coverUrl` |
| `readTime: "4 hr read"` | `read_time_minutes` |
| `price` float / `$` | `price_cents` + `currency` |
| `hero-1` ids | UUIDs |
| `chapter` / `timeLeft` | `chapter_label`; compute `timeLeft` from remaining progress |
| `dateOfBirth` | `date_of_birth` (`YYYY-MM-DD`) |
| editable email | Auth-owned — not on `profile-update` |
| `renewsOn` | `entitlement.expires_at` |
| `plan: "Premium"` | `canAccessPremium` (+ nested `entitlement.plan`) |
| `initials` / `memberSince` | derive from `full_name` / `created_at` |
| `count: "24 books"` | `book_count` (number) |
| Lucide `icon` | `icon_key` (string) |

---

## Progress

- `progress` is a fraction **0.0–1.0**.
- Or send `progress_percent` **0–100**. Never both.
- `POST /reading-progress` merges: omitted fields stay unchanged; `chapter_label: ""` clears.
- Finished shelf: `progress >= 0.99`.

---

## Premium gate

`GET entitlements-status` → `{ isActive, isAdmin, canAccessPremium, entitlement }`.

**Gate premium UI and Read CTAs on `canAccessPremium`, not `isActive`.**  
Admins have no subscription but `get-signed-pdf` still serves them.

Access for a PDF:

1. caller is admin, or
2. book is free (`is_premium = false`) and published, or
3. book is premium and entitlement is active

Otherwise `403 PREMIUM_REQUIRED`.

---

## Do not

| Action | Why |
| --- | --- |
| Call `POST /functions/v1/signed-pdf` | Deprecated → `410` |
| Client-write `entitlements` | Webhook / service role / admin promotional only |
| Ship `service_role` in the app | Anon + user JWT only |
| Expect `pdf_path` on public payloads | Bytes only via `get-signed-pdf` |
| Re-download every open | Save to device FS after first signed URL |

---

## Pagination

- Defaults: `page=1`, `pageSize=20` (max 100).
- Offset past 10,000 rows → `400 PAGE_OUT_OF_RANGE`.
- Empty final page is a success with `data: []`, not a 404.
