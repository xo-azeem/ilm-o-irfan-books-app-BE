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

Discover filters — `category`, `premium`, `minRating`, `language`, `length`, `sort` — are
accepted by **both** `books-list` and `books-search` and applied before pagination, so the
page meta describes the matches. Unknown parameters and unknown values are ignored rather
than rejected. Full reference: [api-endpoints.md → Discover filters](./api-endpoints.md#discover-filters).

The "Downloaded only" toggle stays on the client: `books-list` is public and
unauthenticated, so it cannot know what this reader downloaded. That state comes from
`downloads-list`.
| Categories chips | GET | `/functions/v1/categories-list` | Public |
| Collection tap | GET | `/functions/v1/collection-books?id=` or `?slug=` | Public |

`collection-books` paginates only **published** books. Draft / missing titles still listed in `collection_books` do not count toward `totalCount` or consume page offset.

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
| `read_time_minutes` | number \| null | Format on client (`"4 hr read"`). Derived from file size — an estimate, not a measurement |
| `page_count` | number \| null | Real page count when known (admin, or learned from the reader) |
| `length_bucket` | `short` \| `medium` \| `long` \| null | Computed; `null` when the book has no length signal |
| `language` | `urdu` \| `english` \| `arabic` \| null | `null` = not recorded, and matches no language filter |
| `price_cents` | number | **Do not render.** Books are not sold individually — see below |
| `currency` | string | e.g. `PKR`. Same: not a book price the reader can act on |
| `format` | string \| null | |
| `is_premium` | boolean | Catalogue label + Discover filter. **Not** an access signal |
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
| `price` float / `$` | `price_cents` + `currency` (marketing); checkout uses RevenueCat store price |
| `hero-1` ids | UUIDs |
| `chapter` / `timeLeft` | `chapter_label`; compute `timeLeft` from remaining progress |
| `dateOfBirth` | `date_of_birth` (`YYYY-MM-DD`) |
| editable email | Auth-owned — not on `profile-update` |
| `renewsOn` | `entitlement.expires_at` |
| `plan: "Premium"` | `canAccessPremium` (+ nested `entitlement.plan`) |
| `initials` / `memberSince` | derive from `full_name` / `created_at` |
| `count: "24 books"` | `book_count` (number) |
| Lucide `icon` | `icon_key` (string) |
| About / support email | `home-feed.supportEmail` (`app_settings.support_email`) |
| Saved lessons | `wishlist-*` endpoints |

---

## Auth signup metadata

Pass on `signUp` / OAuth so `handle_new_user` fills `profiles`:

| Metadata key | Profile column | Notes |
| --- | --- | --- |
| `full_name` (or `name`) | `full_name` | Prefer `full_name` |
| `phone` | `phone` | Optional |

Email comes from Auth, not metadata. After admin promote, force re-login so JWT picks up `app_metadata.app_role`.

---

## Home shelves

`shelves.trending` / `newArrivals` / `hero` are **curated** collection membership (`trending`, `new-arrivals`, `home-hero`), not a most-read algorithm. Empty shelves fall back to newest published books.

- `progress` is a fraction **0.0–1.0**.
- Or send `progress_percent` **0–100**. Never both.
- `POST /reading-progress` merges: omitted fields stay unchanged; `chapter_label: ""` clears.
- Finished shelf: `progress >= 0.99`.

---

## Premium gate

`GET entitlements-status` → `{ isActive, isAdmin, canAccessPremium, entitlement }`.

**Gate premium UI and Read CTAs on `canAccessPremium`, not `isActive`.**  
Admins have no subscription but `get-signed-pdf` still serves them.

**The catalogue is subscription-only.** Every title requires an active
membership. There is no free tier and no per-book purchase.

Access for a PDF:

1. caller is admin (including unpublished drafts), or
2. book is published and the caller's entitlement is active

Otherwise `403 PREMIUM_REQUIRED`.

`is_premium` is **not** consulted. It still labels a book in the catalogue and
still works as a Discover filter, but it does not decide access — a book
flagged `is_premium: false` is gated exactly like any other. Do not branch
reader access on it.

| Caller | Status | `error.code` |
| --- | --- | --- |
| Signed out / no token | `401` | `AUTH_REQUIRED` |
| Signed in, no active subscription | `403` | `PREMIUM_REQUIRED` |
| Signed in, active subscription | `200` | — (`signedUrl`) |
| Admin, no subscription | `200` | — (drafts included) |

### Book price fields

`books.price_cents` / `currency` stay on the payload (admin tooling and
reporting read them) but they are **kept at 0 and mean nothing to a reader** —
under a subscription-only catalogue there is no per-book purchase to price.

The app should drop the book price label outright rather than render it
conditionally on a non-zero value. A conditional is a trapdoor: one admin
typing a number into the price field would make a "buy this book" affordance
appear next to a book nobody can buy.

### Plan prices vs store IAP

- `plans-list` / plan rows expose `price_cents` + `currency` for **catalog copy** (e.g. PKR marketing).
- The amount charged at purchase comes from **App Store / Play via RevenueCat** — show that localized price on buy buttons.
- Never client-write `entitlements`. Comps: admin `admin-set-entitlement` (`store=promotional`); RC webhooks can overwrite.

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
