# API endpoint plan

This project is built on Supabase + PostgreSQL, so most app endpoints will either map to:

- Supabase table queries with RLS
- Edge Functions for privileged logic
- RPCs for admin or deep business actions

## Public endpoints

The Edge Function endpoint base is `/functions/v1/...`.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/app-status` | GET | Public | The product flags every install checks before Home: `maintenanceMode`, `maintenanceMessage`, `signupEnabled`, `minSupportedVersion`, `supportEmail`, `updatedAt` — see [App status](#app-status) |
| `/functions/v1/home-feed` | GET | Public | Collections (admin-made only), categories, newest books, `carousel`, `shelves.hero` / `trending` / `newArrivals`, `shelvesMeta`, `featuredCollectionId`, `supportEmail` (book cards include `coverUrl`) — see [Home shelves](#home-shelves) |
| `/functions/v1/books-list` | GET | Public | Paginated published books — see [Discover filters](#discover-filters) |
| `/functions/v1/book-detail?id=<bookId>` | GET | Public | Book detail with author and metadata (`coverUrl`; no `pdf_path`) |
| `/functions/v1/books-search?q=<query>` | GET | Public | Prefix search, plus the same [Discover filters](#discover-filters) as `books-list` |
| `/functions/v1/categories-list` | GET | Public | Browse categories |
| `/functions/v1/collections-list` | GET | Public | Admin-made collections (published, `sort_order`); the three system shelves are excluded — see [Collections](#collections) |
| `/functions/v1/collection-books?id=` or `?slug=` | GET | Public | Paginated books of one published collection, plus `source` — see [Collections](#collections) |
| `/functions/v1/plans-list` | GET | Public | Plan catalog for premium screen |
| `/functions/v1/carousel-list` | GET | Public | The admin-curated home carousel — see [Home carousel](#home-carousel) |
| `/functions/v1/trending-weekly?limit=10` | GET | Public | Ten books drawn at random once a week — see [Weekly trending](#weekly-trending) |

## Authenticated endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/profile-read?tz=` | GET | User | Own profile + `streak` (with `recent_days`), `readingGoal`, `achievements` — see [Reading record](#reading-record) |
| `/functions/v1/reading-goal-update` | POST | User | `{ target: 1-100 }` → the `readingGoal` object — see [Reading record](#reading-record) |
| `/functions/v1/profile-update` | PUT/PATCH | User | Partial contact fields including `date_of_birth` (YYYY-MM-DD); email/role not writable |
| `/functions/v1/reading-progress` | GET/POST | User | Reading position: one row (`?book_id=`), the full list, or a last-write-wins upsert — see [Reading position](#reading-position-and-bookmarks) |
| `/functions/v1/wishlist-list` | GET | User | List saved books |
| `/functions/v1/wishlist-toggle` | POST | User | Save or remove favorite books |
| `/functions/v1/downloads-list` | GET | User | Download metadata and history |
| `/functions/v1/downloads-create` | POST | User | Record a completed download |
| `/functions/v1/highlights-list` | GET | User | Highlights / bookmarks in page order (`?book_id=`, `pageSize` ≤ 200) |
| `/functions/v1/highlights-upsert` | POST | User | Upsert on `(book_id, page_number)` → row + `created`; edit by `id` |
| `/functions/v1/highlights-toggle` | POST | User | Bookmark button: create or delete on `(book_id, page_number)` in one call |
| `/functions/v1/highlights-delete` | POST | User | Delete by `{ id }` or `{ book_id, page_number }`; missing → `deleted: false` |
| `/functions/v1/library-overview` | GET | User | Combined shelves: wishlist, in-progress, finished (`progress >= 0.99`), downloads, highlights. Progress rows carry `finished_at` |
| `/functions/v1/entitlements-status` | GET | User | Current premium state, plus `store` / `cancelRequestedAt` / `cancelPending` |
| `/functions/v1/subscription-cancel` | POST | User | Records the reader's request to cancel; the app then opens the store's manage-subscriptions sheet — see [Cancelling a membership](#cancelling-a-membership) |
| `/functions/v1/get-signed-pdf` | POST | User | Signed PDF URL for premium or allowed access; carries `pdfUpdatedAt`, the stamp of the file being served |
| `/functions/v1/vault-check` | POST | User | `{ bookIds }` → which still exist and their `pdfUpdatedAt` — see [Replaced and deleted books](#replaced-and-deleted-books) |
| `/functions/v1/avatar-upload-url` | POST | User | One-shot signed upload URL for the caller's avatar |
| `/functions/v1/recommendations` | GET | User | Personalised "Because you read …" rails — see [Recommendations](#recommendations) |

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
| `/functions/v1/admin-set-category-books` | POST | Admin | Replace the set of books tagged with a category |
| `/functions/v1/admin-publish-upload-batch` | POST | Admin | `{ batchId }` → publish every book in a bulk upload — see [Bulk uploads](#bulk-uploads) |
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
| `/functions/v1/admin-category-create` | POST | Admin | Create category (`label` required) |
| `/functions/v1/admin-category-update` | PATCH | Admin | Update category fields |
| `/functions/v1/admin-category-delete` | POST | Admin | Delete category; 409 while books use it unless `force` |
| `/functions/v1/admin-collection-create` | POST | Admin | Create collection (`title` required, `kind` defaults to `shelf`) |
| `/functions/v1/admin-collection-update` | PATCH | Admin | Update collection fields |
| `/functions/v1/admin-collection-delete` | POST | Admin | Delete collection; 409 if it is the featured one unless `force` |
| `/functions/v1/admin-plans` | GET | Admin | All plans including inactive, with entitlement counts |
| `/functions/v1/admin-plan-create` | POST | Admin | Create plan (`code`, `name`, `price_cents` required) |
| `/functions/v1/admin-plan-update` | PATCH | Admin | Update plan pricing, interval, features, RC product id |
| `/functions/v1/admin-plan-delete` | POST | Admin | Delete plan; 409 while entitlements reference it unless `force` |
| `/functions/v1/admin-audit-log` | GET | Admin | Who changed what: filter by `entityType`, `entityId`, `actorId`, `action`, `since` |
| `/functions/v1/admin-carousel` | GET | Admin | Every carousel slide, including inactive and scheduled ones (`is_live` says which are showing) |
| `/functions/v1/admin-carousel-set` | POST | Admin | Replace the whole carousel with an ordered `bookIds` list |
| `/functions/v1/admin-carousel-upsert` | POST/PATCH | Admin | Add a book to the carousel, or edit the slide already there |
| `/functions/v1/admin-carousel-delete` | POST | Admin | Remove slides, by slide id or book id |
| `/functions/v1/admin-carousel-reorder` | POST | Admin | Persist a drag-reorder of the carousel |
| `/functions/v1/admin-refresh-trending` | POST | Admin | Redraw this week's trending picks without waiting for Monday |
| `/functions/v1/admin-refresh-carousel` | POST | Admin | Redraw this week's carousel fallback picks without waiting for Monday |

## Webhooks

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/revenuecat-webhook` | POST | Shared secret (`REVENUECAT_WEBHOOK_AUTH`) | Idempotent entitlement sync |

Requires `event.id` (UUID), `app_user_id` (Supabase Auth UUID), `type`, and `event_timestamp_ms`.
Duplicates return `200` with `data.duplicate`; stale events return `200` with `data.stale`.

Plan resolution: match `event.product_id` to `plans.revenuecat_product_id` when present; otherwise
(and when the SKU is unknown) use plan code `premium_monthly`. Store mapping:
`APP_STORE` / `MAC_APP_STORE` → `app_store`, `PLAY_STORE` → `play_store`. Applied responses include
`store` and `planId` for ops debugging.
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
| `CONFLICT` | 409 | The row is still referenced; retry with `force: true` if that is intended |
| `PAGE_OUT_OF_RANGE` | 400 | Offset pagination stops at 10,000 rows — narrow the query |
| `UNEXPECTED_ERROR` | 500 | Unhandled failure — check the function logs |

Every endpoint enforces its documented method and answers `OPTIONS` preflight. A verb the
handler does not implement is a `405`, never a silent fallthrough to the GET path.

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
| `PDF_PATH_MISSING` | 400 | `admin-book-create` / `admin-book-update` — publish requested with no `pdf_path` |
| `PDF_NOT_IN_STORAGE` | 400 | `admin-book-create` / `admin-book-update` — `pdf_path` matches no object in the `pdfs` bucket |
| `AVATAR_UPLOAD_URL_FAILED` | 500 | `avatar-upload-url` — Storage refused to mint the URL |
| `LAST_ADMIN` | 409 | `admin-set-user-role` — refuses to demote the only remaining admin |

## Premium access

The catalogue is **subscription-only**: every title requires an active membership. There
is no free tier and no per-book purchase.

Access to a PDF through `get-signed-pdf` is granted when **either** of the following is
true, and there is no third case:

1. `profiles.role = 'admin'` (or JWT `app_metadata.app_role = 'admin'`) — admins read any
   PDF, published or draft, with no subscription.
2. The book is published and `public.entitlement_has_access(status, expires_at)` is true
   for the caller (same rule as `canAccessPremium` / `my_access_state()`).

Do **not** gate on `status = 'active'` alone — trial, cancelled (paid through), grace, and
billing_issue can still grant access until `expires_at`.

`books.is_premium` is **not** consulted. It used to carve out a "published and free"
branch, which meant one unset flag — a bulk-action misclick, an importer default, a seed
script — handed a paid PDF to every signed-in reader. The flag still labels a book and
still drives the `premium` Discover filter, but it stopped being load-bearing for access.
It defaults to `true` for new rows.

There is no global override either: the `ALLOW_PDF_WITHOUT_ENTITLEMENT` env flag was
removed from the code, and `app_settings.allow_pdf_without_entitlement` has been dropped
from the schema. An entitlement is the only way in.

| Caller | Status | `error.code` |
| --- | --- | --- |
| No token / invalid token | 401 | `AUTH_REQUIRED` |
| Signed in, no active entitlement | 403 | `PREMIUM_REQUIRED` |
| Signed in, active entitlement | 200 | — |
| Admin, no entitlement | 200 | — (drafts included) |

A book that does not exist, or an unpublished one requested by a non-admin, is `404
NOT_FOUND` — the gate never reveals that a draft exists.

### What ends a subscription

`expires_at`, and nothing else. The rule is `public.entitlement_has_access(status,
expires_at)` and every gate calls it rather than testing `status` directly:

> Access = status is not `expired`, **and** (`expires_at` is null or still in the future).

So `trial`, `cancelled` (will not renew, but paid through the period), `grace` and
`billing_issue` (card failing, still inside the paid period) all keep reading right up to
`expires_at`. A null `expires_at` is a lifetime or promotional grant and never lapses.
`expired` denies on its own, whatever the date says — that is how a refund revokes
immediately.

This used to be `status = 'active'`, duplicated in two endpoints, which locked out every
trial and every cancelled-but-paid-for month.

### Expiry, and how it reaches the device

Nothing writes to the database when `now()` crosses `expires_at`, so there is no event to
push. Three layers cover it:

1. **The gate.** `get-signed-pdf` re-evaluates on every open and refuses the instant the
   date passes — with no cron run and no socket involved.
2. **The sweep.** `public.expire_lapsed_entitlements()` runs minutely under pg_cron and
   flips lapsed rows to `expired`, turning the passage of time into an UPDATE. That fires a
   Realtime broadcast on the reader's private topic, bounding the pushed lock at ~60s.
3. **The client countdown.** The app knows `expires_at` and locks to the second, offline.

The socket is a correction channel, not the lock — see
[mobile-contract.md](./mobile-contract.md#when-the-subscription-ends-mid-read).

Signed URLs are **clamped to the remaining subscription** (floor 15s). A minted URL cannot
be recalled, so one issued ten seconds before expiry must not stay valid for five minutes.

### The live channel

**Postgres Changes** on `public.access_events`, INSERT only, filtered
`user_id=eq.<user_id>`. Each row carries the same computed answer as the
`entitlements-status` body (in snake_case): `can_access_premium`, `is_active`, `is_admin`,
`status`, `expires_at`, `reason`, `seconds_remaining`, `server_time`.

RLS scopes the table to the reader's own rows, `anon` has no grant at all, and no
INSERT/UPDATE/DELETE policy exists — so a device can neither eavesdrop nor forge itself an
unlock. The table deliberately carries no billing internals: `entitlements.raw_event` is
the entire RevenueCat payload, and Postgres Changes ships whole rows to the device.

Clients should read the subscription shape from `entitlements-status.realtime` rather than
hardcoding it.

> **Why not Realtime Broadcast.** The original design used `realtime.send()` to a private
> per-reader topic, which scales better. It is undeliverable on the hosted project:
> `realtime.messages` is partitioned by day, the project has **no partitions**, and
> `realtime.send()` downgrades the resulting insert failure to a warning — so every
> message vanished silently while the entitlement write still committed. Creating
> partitions requires privileges on the `realtime` schema that the `postgres` role does not
> have. The broadcast call remains in the trigger and resumes working by itself if
> partitions ever appear. See
> [runbooks/subscription-expiry.md](./runbooks/subscription-expiry.md#why-not-broadcast).

`entitlements-status` reports:

```jsonc
{ "data": {
    "isActive": false,          // the subscription alone
    "isAdmin": true,            // profiles.role or the app_role JWT claim
    "canAccessPremium": true,   // isActive || isAdmin  <- gate premium UI on this
    "entitlement": null,
    "status": null,             // active|trial|cancelled|grace|billing_issue|expired
    "startsAt": null,
    "expiresAt": null,          // null = no end date (lifetime, comp, or admin)
    "secondsRemaining": null,   // null when expiresAt is null; never negative
    "reason": "admin",          // why, so the paywall can say something useful
    "store": null,              // app_store | play_store | stripe | promotional | unknown | null
    "cancelRequestedAt": null,  // set by subscription-cancel until the store confirms
    "cancelPending": false,     // cancelRequestedAt set AND status still renewing
    "serverTime": "2026-09-09T12:00:00Z",   // client clock-skew correction
    "realtime": { "mode": "postgres_changes", "channel": "access:<user_id>",
                  "schema": "public", "table": "access_events", "event": "INSERT",
                  "filter": "user_id=eq.<user_id>" } } }
```

Gating on `isActive` alone would show an admin a locked button on a file the backend would
serve them. Every book now needs `canAccessPremium` to open — there is no book that
bypasses it.

## Home shelves

`home-feed` returns three rails under `shelves`. The app renders them verbatim — it does
not re-sort them or top them up — so what the backend puts there is exactly what Home shows.

| Rail | Source | Length | Empty-source fallback |
| --- | --- | --- | --- |
| `hero` | `collections.slug = 'home-hero'`, in `sort_order` | up to 8 | 5 newest published books |
| `trending` | `collection_page('trending')` — this week's draw, see [Weekly trending](#weekly-trending) | 10 | none needed |
| `newArrivals` | `collection_page('new-arrivals')` — curated members, else every published book newest-first | 10 | built in (`source: "newest"`) |

`trending` and `newArrivals` are the **first page of the same list `collection-books`
serves** for that collection, so "See all" on a rail opens the rail continued. The
`shelvesMeta` object says where to go and what it will find:

```jsonc
"shelvesMeta": {
  "trending":    { "collectionId": "4444…4002", "slug": "trending",     "totalCount": 20, "source": "weekly" },
  "newArrivals": { "collectionId": "4444…4003", "slug": "new-arrivals", "totalCount": 20, "source": "newest" }
}
```

- `collectionId` — pass to `collection-books?id=`. `null` when the rail has no page right
  now: the admin unpublished that system shelf (the rail is then `[]` too), or the trending
  read failed and the rail degraded to the newest books.
- `totalCount` — length of the full list, for "See all N".
- `source` — `curated` | `weekly` | `newest`, the same value `collection-books` returns.

`hero` stays a plain curated shelf with its newest-books fallback and has no page.

`home-feed` also returns a top-level `carousel` array, the same payload as `carousel-list`'s
`slides`, plus `carouselSource` (`admin` or `fallback` — see [Home carousel](#home-carousel)).
It ships inside `home-feed` because it is the first thing on the screen and a second round
trip to fill it is a second chance for Home to render half-empty. A `carousel` read failure
degrades to `[]` rather than failing the screen; the other four reads still 500.

Each entry is a full `book_list_items` row plus `coverUrl` — the same shape `books-list`
returns — so a card never renders with a blank field and the app never builds a Storage URL.

Book rows are not seeded from this repo, so a local `supabase db reset` gives an empty
catalogue and every rail comes back `[]`; run `npm run books:import` if you need titles
locally.

## Collections

Every collection is a row in `collections`. Three of them are **system shelves** —
`home-hero`, `trending`, `new-arrivals` — which `home-feed` renders as its own rails. An
admin can retitle, re-subtitle, reorder or unpublish them, but they cannot be deleted or
given another slug: `admin-collection-delete` (and a direct `DELETE` on `collections`)
answers `409 CONFLICT` — `system collection "trending" cannot be deleted; unpublish it
instead` — and a slug change is `400 INVALID_REQUEST`.

`collections-list` and `home-feed.collections` return only the **admin-made** collections
(published, in `sort_order`). The rows also carry `is_system` (always `false` there);
`admin_collection_rows` carries it too, alongside `book_count` (all members) and
`published_count` (what readers will see). `collection_summaries.book_count` counts
published members only.

`collection-books?id=` / `?slug=` pages one collection and says what it paged:

| Collection | List | `source` |
| --- | --- | --- |
| `trending` | this week's draw (`weekly_trending_books`), draw order; `totalCount` = draw length | `weekly` |
| `new-arrivals` with curated members | members, published only, admin `sort_order` | `curated` |
| `new-arrivals` with no members | every published book, newest first; `totalCount` = published count | `newest` |
| anything else | members, published only, admin `sort_order` | `curated` |

Unknown or unpublished collections are `404 NOT_FOUND`. A page past the end is an empty
page with the true `totalCount`, not an error. Both endpoints send `public, max-age=60`, so
an admin edit — including an `admin-refresh-trending` re-roll — reaches the app within a
minute (`trending-weekly` itself still caches for 15 minutes).

## Discover filters

`books-list` and `books-search` take the same filters and run the same query
(`public.catalog_books`), so a filter cannot mean one thing while browsing and another
while searching. Browsing is simply the query with no text term.

**Everything is applied before `LIMIT`/`OFFSET`**, so `totalCount`, `totalPages` and
`hasNextPage` describe the matches rather than the page that happened to arrive. That is
the point: filtering on the client made `totalCount` describe the wrong set and turned
`hasNextPage` into "more rows", which forced a load-more loop to walk the catalogue to
fill one screen.

| Parameter | Values | Meaning |
| --- | --- | --- |
| `category` | uuid or slug | Membership in `book_categories`. Unknown value → `404 NOT_FOUND` |
| `premium` | `true` \| `false` (`1`/`0`) | `books.is_premium` |
| `minRating` | number 0–5 | `rating >= minRating`, clamped into range |
| `language` | `urdu` \| `english` \| `arabic`, comma-separated | `books.language`; `NULL` matches nothing |
| `length` | `short` \| `medium` \| `long`, comma-separated | see below |
| `sort` | `newest` \| `rating` \| `title` \| `relevance` | default `newest`, or `relevance` when `q` is present |

- Different parameters **AND** together; repeated values inside one parameter **OR**
  together (`length=short,long`). A repeated key (`?language=urdu&language=english`) is
  equivalent to the comma form.
- **Unknown parameters and unknown values are ignored, never a 400.** An older app build
  has to keep working against a newer deployment and vice versa. `language=urdu,klingon`
  filters on `urdu`; `language=klingon` filters on nothing.
- Zero matches is `200` with `data: []`.
- `pageSize` is still capped at 100.

### Length buckets

`length` is a named bucket, not a minutes range, because the chips are multi-select — a
reader can pick "short" *and* "long", which no single min/max can express — and because
the boundary then lives in one place instead of being duplicated in the client.

| Bucket | Pages |
| --- | --- |
| `short` | < 200 |
| `medium` | 200 – 599 |
| `long` | >= 600 |

Pages come from `books.page_count` when it is set, and otherwise from
`ceil(read_time_minutes / 1.5)` — the same 1.5 min/page constant the app was already
using, so nothing changes shelf on the day this ships. A book with neither signal is in
**no** bucket and is excluded from every `length` filter.

Be aware what the fallback actually measures: `read_time_minutes` is not a measured
reading time. `scripts/import-folder-books.mjs` derives it from PDF file size at 40 KB
per minute. `page_count` is the honest field — it is admin-editable, and it is filled in
automatically the first time a reader opens the book, because
`reading-progress.total_pages` is a real count reported by the reader itself. Once set it
is never overwritten by the estimate.

`book_list_items` and `book-detail` both expose `language`, `page_count` and the computed
`length_bucket`, so the app can label a chip without recomputing the boundary.

### Search

`books-search` matches a **prefix** against a `simple`-configuration tsvector, so `jan`
finds *Jannat Ki Talash* and *Janooniyat* on the first keystroke. The `english`
configuration is deliberately not used: it stems, and this catalogue is transliterated
Urdu, which an English stemmer mangles.

A trigram `ILIKE` arm runs alongside it for queries of 3 characters or more, which is how
author names are searchable at all — authors live on their own table and were never in
the books search vector.

Search terms are reduced to word characters before they reach `to_tsquery`, so a query
containing `&`, `|` or `:*` is data rather than syntax.

## Home carousel

The carousel is admin-owned. The app renders `carousel-list` (or `home-feed`'s `carousel`)
in the order it arrives and picks nothing itself.

```json
{ "data": { "source": "admin", "slides": [ ... ] } }
```

While the admin has **no live slide**, the rail is filled server-side with **five books drawn at
random from the published catalogue, once a week** — the same five for every caller until
Monday 00:00 UTC, drawn the same way as [Weekly trending](#weekly-trending) and stored in
`carousel_weekly`. `source` says which you are looking at: `admin` (the curated rail) or
`fallback` (the weekly draw). Fallback slides have `slide_id: null` and no `badge`,
`subtitle` or `cta_label`; `headline`, `imageUrl` and `accent` are the book's own title,
cover and colour, so one renderer handles both. The draw prefers books that are not already
at the top of this week's Trending rail, so Home does not show the same covers twice.

The fallback is a fallback, not a merge: the moment one admin slide is live it is the whole
carousel, and removing the last slide brings the draw back. `source` is `admin` with an
empty `slides` only when the catalogue itself has nothing published.

One row per slide in `carousel_slides`, one slide per book. `headline`, `image_path` and
`accent` come back already resolved: the admin's override where there is one, the book's own
`title` / `cover_path` / `cover_color` where there is not. Every `book_list_items` column
rides along, so tapping a slide opens the book with no second fetch.

| Field | Meaning |
| --- | --- |
| `slide_id` | Identity of the slide, for admin edit / delete / reorder |
| `imageUrl` | Ready-to-load artwork URL: the override if set, else the book cover. **Draw the slide from this.** |
| `coverUrl` | Ready-to-load URL for the book's own cover |
| `book_id`, `slug`, `title`, `author_name`, `cover_path`, … | The book card, same shape as `books-list` |
| `headline` | Slide title: override, falling back to `title` |
| `subtitle` | Optional line under the headline; `null` when unset |
| `image_path` | Artwork: override, falling back to `cover_path` |
| `accent` | Accent colour: override, falling back to `cover_color` |
| `badge`, `cta_label` | Optional chip and button label; `null` when unset |
| `sort_order` | The admin's order. Already applied; do not re-sort |

A slide is only in the payload when it is active, inside its `starts_at`/`ends_at` window,
and its book is still published — enforced by the `carousel_items` view and again by RLS on
`carousel_slides`, so an unpublished title cannot leak through the carousel. `admin-carousel`
returns every slide regardless, each with `is_live` saying whether the app is showing it.

Writes go through the `admin_carousel_*` RPCs, never a direct table write, so the admin check
and the audit-log entry cannot be skipped. `admin-carousel-set` replaces the whole rail in one
statement — the app never observes a half-applied carousel — and slides that survive the save
keep the headline and artwork already written for them.

Cached `public, max-age=60`. Editorial changes reach the app within about a minute.
`admin-refresh-carousel` redraws this week's fallback picks (only visible while no admin
slide is live); `admin_carousel_fallback_rows` shows the CMS what the app is falling back to.

## Weekly trending

Ten books drawn at random from the published catalogue, **once a week**. Every caller sees
the same ten until Monday 00:00 UTC, when the next draw happens on the first request of the
week. This is what `random_published_books` could not do: it re-drew per call, so the rail
changed under a user who pulled to refresh.

```json
{ "data": { "weekStart": "2026-09-07T00:00:00.000Z",
            "expiresAt": "2026-09-14T00:00:00.000Z",
            "books": [ /* book_list_items rows */ ] } }
```

The draw is stored in `trending_weekly`, so a read is an indexed ten-row lookup rather than
an `order by random()` over the catalogue. Thirty picks are stored and the first ten still
published are returned, so a title unpublished mid-week shortens the spare pool instead of
leaving a hole in the rail. Rows older than eight weeks are pruned on the next draw.

Cached `public, max-age=900`. `admin-refresh-trending` redraws the current week when the
draw surfaced something that should not be leading Home.

## Recommendations

`GET /functions/v1/recommendations?limit=20&sections=3&perSection=10`

Built from what the caller actually did — `reading_progress` (weighted by how far in and how
recently), `downloads`, `wishlist` and `highlights` — with each signal decaying over about a
month so last year's binge stops outvoting this month's reading. Those weights roll up into
author, genre, category and tag affinities; candidates are scored against all four, and the
dimension that contributed most becomes the reason shown to the user.

```json
{ "data": {
  "generatedAt": "2026-09-07T22:11:44.677Z",
  "isPersonalized": true,
  "sections": [ {
    "id": "seed:<bookId>",
    "seedBookId": "<bookId>",
    "reasonType": "author",
    "reasonLabel": "Ibn Sina",
    "title": "Because you read The Book of Healing",
    "subtitle": "More from Ibn Sina",
    "seedBook": { /* book_list_items row */ },
    "books": [ { /* book_list_items row */, "reason": { "type": "author", "label": "Ibn Sina", "seedBookId": "…" } } ]
  } ],
  "books": [ /* the same cards, flat and ranked, for a see-all screen */ ]
} }
```

`title` and `subtitle` are composed server-side, so the app never has to assemble the caption
and never captions a rail with a book the recommendation had nothing to do with. Anything the
user has already read, downloaded or wishlisted is excluded.

`isPersonalized: false` with `sections: []` is the cold-start answer for an account with no
history: `books` is then well-rated recent titles, every `reason.type` is `"popular"`, and the
app should render them under a neutral heading rather than "Because you read …".

Scale: results are materialised per user in `user_recommendations` and served from a
primary-key read. A rebuild only runs when the user's signals have moved since the last one
(and at most every 30 minutes), or once a day regardless — so a user who reads all evening is
recomputed twice, and one who never opens a book is never recomputed. The endpoint is
per-user and sends no cache headers; never cache it across users.

## Publishing a book

`is_published = true` is refused unless the file is actually there:

| Condition | Result |
| --- | --- |
| No `pdf_path` on the row and none in the request | `400 PDF_PATH_MISSING` |
| `pdf_path` set but no matching object in `pdfs` | `400 PDF_NOT_IN_STORAGE` |
| `pdf_path` set and the object exists | Published |

The same check runs for `admin-book-create`, `admin-book-update`, and each id in
`admin-bulk-update-books` — the bulk response returns `skippedBooks: [{ id, reason }]`
rather than failing the batch. Upload the PDF first, then publish.

## Bulk uploads

A set of books can be added one at a time and released together. The admin app
creates an `upload_batches` row (a title, an optional destination
`collection_id` and `category_id`), then saves each book as an ordinary
unpublished row with `books.upload_batch_id` set. Nothing else changes: drafts
are already invisible to every reader endpoint, and a collection created for
the upload is inserted with `is_published = false`.

`admin-publish-upload-batch` takes `{ batchId }` and calls
`admin_publish_upload_batch(uuid)` with the caller's JWT:

1. Every book in the batch is joined to the destination collection (appended
   in creation order) and category, `on conflict do nothing` — so a
   destination chosen after the books were added still gets them.
2. The books go through `admin_bulk_update_books(ids, true, null)`, so the
   storage check above applies to each one and the response carries the same
   `updated` / `skipped` / `skippedBooks`.
3. Only when nothing was skipped and every book in the batch is live does the
   batch become `status = 'published'` (with `published_at`), and a hidden
   destination collection is switched on. A partial run leaves the batch in
   draft with the eligible titles already live; fix the skipped ones and call
   again.

Response: `{ batchId, updated, skipped, skippedBooks, batchPublished }`.
`404 NOT_FOUND` for an unknown batch; `400 INVALID_REQUEST` when the batch has
no books. The admin list reads `admin_upload_batch_rows` (`book_count`,
`ready_count`, `published_count`, destination titles) and the books of one
batch come from `admin_book_rows` filtered by `upload_batch_id`. Deleting a
batch sets the column to null on its books; they stay as drafts.

## Replaced and deleted books

A downloaded book is a sealed copy of one particular file on the device, opened
with no round trip. Two admin actions make that copy wrong, and the device is
told about both through one stamp: `books.pdf_updated_at`, the instant the
current `pdf_path` was attached. Every upload lands at a fresh storage path, so
a trigger bumps the stamp on exactly the writes that replace the file.

| Admin action | Server | Device |
| --- | --- | --- |
| Replace the PDF (`pdf_path` changes) | `pdf_updated_at` bumped; the book's `downloads` rows deleted — nobody has the new file | Copy dropped; the reader is told the file was updated and can download again |
| Delete the book | Cascade removes downloads, progress, wishlist, highlights | Copy dropped; the reader is told the book is no longer available |
| Unpublish | Nothing | Nothing — the copy stays; only fetching it again is refused |

`get-signed-pdf` returns `pdfUpdatedAt` so the device records which file it
downloaded. `vault-check` takes `{ bookIds: uuid[] }` (at most 200) and answers
`{ books: [{ bookId, pdfUpdatedAt, hasPdf, isPublished }] }` for the ids that
still exist; the device treats an absent id as deleted and a different stamp as
replaced, and touches nothing on any error. It runs at sign-in, on every return
to the foreground, and behind every offline open — so a revoked book is closed
the moment the device has a connection, even mid-read. The same rows come from
the `vault_check(uuid[])` RPC directly.

## Push notifications

Readers get tray notifications for the catalogue changes that concern them.
The database records each change in `push_outbox`; the `push-dispatch` Edge
Function sends it through FCM HTTP v1. Nothing in the app calls the dispatcher —
the outbox's insert trigger kicks it through pg_net, and a minutely pg_cron tick
catches merged and retried rows. Wiring (secrets, `private.runtime_config`) is
in [setup-guide.md → Push notifications](./setup-guide.md#push-notifications).

| Kind | Trigger | Audience | Tap opens |
| --- | --- | --- | --- |
| `books_published` | A book (or, in one statement, N books) goes live and does not sit wholly inside one collection | topic `catalog` | the book, or Home |
| `collection_published` | A non-system collection is live *and* has its first live book — on publish, on its first book being published, or on a bulk upload | topic `catalog` | the collection |
| `collection_books_added` | Live books join an already-announced collection, or a bulk upload lands in one; 2-minute merge window | topic `catalog` | the collection |
| `book_deleted` | A book is deleted | readers who downloaded, read, saved or bookmarked it | My Library |
| `book_file_replaced` | A live book's `pdf_path` changes | the same readers (captured before `downloads` is cleared) | the book |
| `book_updated` | A live book's title, description, author, cover, page count, read time, language or genre changes; 2-minute merge window | the same readers | the book |
| `membership_activated` | `access_events.is_active` flips to true | that reader | Home |
| `membership_expired` | `access_events.is_active` flips to false | that reader | Membership |
| `account_deletion_approved` / `_rejected` | An admin decides a deletion request | that reader | Privacy & security |
| `account_deletion_requested` | A reader files a deletion request (`request_account_deletion`) | **every admin** (`profiles.role = 'admin'`), `route: adminDeletions` | the admin tool's People → Deletions |

Rules that keep it quiet: the admin who made the change is never a recipient;
unpublishing sends nothing (the device keeps its copy, see above); admins get no
membership pushes; a bulk publish is one row, not one per book
(`admin_publish_upload_batch` silences the row triggers with the transaction
setting `app.push_suppress` and enqueues once); pending rows for the same
`(kind, entity_id)` merge, so four saves in two minutes are one push; and the
dispatcher folds several `book_deleted` / `book_updated` / `book_file_replaced`
rows for one reader into a single "3 books were removed".

**Message contract.** Every message carries `notification.title` / `body`
(so the OS draws the tray entry when the app is in the background or killed)
and a string-only `data` map the app routes on:

```json
{ "kind": "book_file_replaced", "route": "book", "bookId": "<uuid>", "count": "1" }
```

`route` is one of `book` (`bookId`), `collection` (`collectionId`), `home`,
`library`, `membership`. Android messages name a notification channel
(`catalog`, `library`, `account`) and a `tag` / `collapse_key` of
`<kind>:<entity>`, so a repeat replaces the earlier tray entry instead of
stacking; iOS gets the same value as `apns-collapse-id` and `thread-id`. The
copy for every kind lives in `_shared/push.ts`.

**Tokens.** The app registers its FCM token with `register_push_token(token,
platform, app_version, device_name, notify_library, notify_membership)` at
sign-in, on every token refresh, once per launch, and whenever a preference
switch flips; `unregister_push_token(token)` on sign-out. Both scope to
`auth.uid()`. The two flags mirror the app's Notifications screen and are
applied by the dispatcher per kind; catalogue announcements go out on the FCM
topic `catalog`, which the device subscribes to itself, so they need no row.
Tokens FCM reports dead are marked `disabled_at`; `prune_push_tables()` (daily)
drops those after 30 days, tokens unseen for 120 days, and sent rows after 14.

**Dispatcher.** `POST /functions/v1/push-dispatch` with header `x-push-secret`
equal to the `PUSH_DISPATCH_SECRET` Edge secret. Claims up to 50 due rows
(`push_outbox_claim`, skip-locked, reclaims rows stuck in `processing` for ten
minutes), sends with 16-way concurrency, and answers
`{ claimed, sent, failed, skipped, requests, disabledTokens }`. A row whose
sends all failed with a retryable FCM error goes back to `pending` with
exponential backoff, up to five attempts. `skipped` means every recipient had
since signed out or turned that kind off. Without the FCM key configured the
function answers `500 PUSH_CONFIG_ERROR` and claims nothing, so rows wait.

## Account deletion

Both stores require in-app account deletion. It is a request, not a button:
a reader files it, an admin approves or declines, and an approved request runs
after a 7-day grace period during which the reader may still cancel. All of the
policy — what blocks a request, how long the grace is — lives in the database
(`20260921120000_account_deletion.sql`); the app only renders it.

**Reader RPCs** (`supabase.rpc`, authenticated, scoped to `auth.uid()`):

| RPC | Answers |
| --- | --- |
| `account_deletion_status()` | `{ request, canRequest, blockers[], warnings[], graceDays }` — `request` is the latest row of any status (so a declined one shows its note), `blockers` are why a new request would be refused, `warnings` what to say before confirming |
| `request_account_deletion(p_reason)` | Files the request; returns the same status object. Raises `SUBSCRIPTION_ACTIVE`, `BILLING_UNRESOLVED`, `ADMIN_ACCOUNT`, `REQUEST_EXISTS` or `REASON_TOO_LONG` as the error *message*, with the human sentence in *details* |
| `cancel_account_deletion_request()` | Withdraws a `pending`, `approved` or `failed` request (not one already `processing`). Raises `NO_OPEN_REQUEST` |

Blockers and warnings, decided by `private.account_deletion_blockers` /
`_warnings`:

| Code | Kind | When |
| --- | --- | --- |
| `SUBSCRIPTION_ACTIVE` | blocker | store entitlement `active` / `trial` and not past `expires_at` — we cannot cancel a store subscription for the reader, and deleting the account would leave them billed |
| `BILLING_UNRESOLVED` | blocker | entitlement `grace` / `billing_issue` — the store is still retrying |
| `ADMIN_ACCOUNT` | blocker | `profiles.role = 'admin'` — demote first |
| `PAID_TIME_FORFEITED` | warning | `cancelled` but paid through a future `expires_at` — remaining time is lost; refunds are the store's |
| `COMP_ACCESS_LOST` | warning | promotional entitlement (never blocks: nobody is billed) |
| `DOWNLOADS_REMOVED` | warning | the reader holds downloads (they stop opening once the account is gone) |

**Admin RPCs** (`is_admin()`):

| RPC | Answers |
| --- | --- |
| `admin_deletion_requests(p_status, p_limit)` | `{ rows[], counts, graceDays }`; `p_status` is a status, `'open'` (pending / approved / processing / failed) or null. Each open row carries its *current* `blockers` and `profileExists` |
| `admin_decide_deletion_request(p_request_id, p_approve, p_note, p_immediate)` | Approve (schedules `now + grace`, or `now` with `p_immediate`) or reject a `pending` / `failed` row. Approval re-checks the blockers. Audited (`entity_type = 'account_deletion_request'`); the reader gets an `account_deletion_approved` / `_rejected` push (route `privacy`) |

**Executor.** `POST /functions/v1/account-deletion-run` with header
`x-ops-secret` equal to the `ACCOUNT_DELETION_SECRET` Edge secret (pg_cron
`account-deletion-tick`, every 15 minutes, via `private.account_deletion_kick`),
or with an admin JWT (the CMS's *Run now*). Claims due `approved` rows
(`account_deletion_claim`, skip-locked → `processing`), re-checks the blockers,
removes the reader's `avatars/<uid>/*` objects and the `auth.users` row (which
cascades through `profiles` to entitlements, downloads, progress, highlights,
wishlist and push tokens), then marks the row `completed` — or `failed` with
the blocker code, for an admin to approve again or reject. The request row has
no foreign key and survives as the record. Answers
`{ claimed, completed, failed, outcomes[] }`.

The app should expect its session to die when the run completes: the next
token refresh fails and `onAuthStateChange` reports `SIGNED_OUT`.

## Cancelling a membership

Memberships are billed by the App Store or Google Play, and **only the store can stop
one renewing** — neither Apple nor Google exposes an API for a third party to cancel a
subscription on the reader's behalf. The backend owns everything around that moment:

1. **The request.** `POST /functions/v1/subscription-cancel` (or the
   `request_subscription_cancellation()` RPC) stamps `entitlements.cancel_requested_at`
   and answers `user_access_state()` plus `{ requested, alreadyCancelled, manageUrl }`.
   The app then opens the store's own sheet (RevenueCat `showManageSubscriptions`, or
   `manageUrl`). Refusals, as `{ error: { code, message } }` with 409:

   | Code | When |
   | --- | --- |
   | `NO_SUBSCRIPTION` | no entitlement, or one that no longer grants access |
   | `NOT_STORE_MANAGED` | `store` is `promotional` / `stripe` / `unknown` — nothing a store sheet can end; the app points at support |

   A row that is already `cancelled` is not an error: `alreadyCancelled: true`.
   A reader who backs out of the store sheet withdraws with the
   `withdraw_subscription_cancellation()` RPC (RPC only; answers the state plus
   `withdrawn`), which clears the pending request and its reminder.

2. **The confirmation.** RevenueCat's `CANCELLATION` webhook → `status = 'cancelled'`.
   Nothing about access changes: `entitlement_has_access()` already keeps a cancelled
   membership open until `expires_at`, the period the reader has paid for, and
   `reason` reads `cancelled_paid_through`. `UNCANCELLATION` puts it back to `active`.
   The BEFORE UPDATE trigger clears `cancel_requested_at` on either.

3. **The mail.** An AFTER UPDATE trigger on `entitlements` writes to `email_outbox` on
   each real status transition, and `email-dispatch` sends through Resend:

   | Kind | Trigger |
   | --- | --- |
   | `membership_cancelled` | `* → cancelled` — "you keep access until *date*, you will not be charged again" |
   | `membership_resumed` | `cancelled → active / trial / grace / billing_issue` |
   | `membership_ended` | `* → expired` (EXPIRATION webhook or the minutely sweep) |
   | `cancellation_unfinished` | `cancel_requested_at` over an hour old with the status still renewing (10-minute sweep, once per request), **or** a renewal landing after the request — the reader was billed; the letter says how to finish in the store and that refunds are the store's |

   Deduplicated per (reader, kind, `expiresAt`) inside an hour, so a webhook replay or
   an admin re-save does not send twice.

**Dispatcher.** `POST /functions/v1/email-dispatch` with header `x-ops-secret` equal to
the `EMAIL_DISPATCH_SECRET` Edge secret (pg_net on insert via
`private.email_dispatch_kick`, plus pg_cron `email-dispatch-tick` every minute). Claims
due rows (`email_outbox_claim`, skip-locked → `processing`, recipient re-read from
`profiles.email`), sends with an idempotency key, writes back `sent` / `failed` /
`skipped` (no address) or a backoff (`pending` again; 429 / 5xx; 5 attempts). Needs
`RESEND_API_KEY` + `EMAIL_FROM`; until they are set every row waits in `pending` and
nothing is lost. Answers `{ claimed, sent, failed, skipped, retried }`.

## Account self-service (sessions, data export, passwords)

`20260923120000_account_sessions_export.sql`. RPC-only; nothing to deploy but the migration.

| RPC | Answers |
| --- | --- |
| `my_sessions()` | The reader's rows from `auth.sessions`: `{ id, createdAt, lastActiveAt, userAgent, ip, isCurrent }[]`, current first. The app sends a readable User-Agent (`IlmOIrfan/<version> (<platform> <os>; <model>)`) so the row names the device |
| `revoke_session(p_session_id)` | Signs one *other* device out (deletes the session; refresh tokens cascade; its access token lives out the hour). Raises `CURRENT_SESSION`, `SESSION_NOT_FOUND`. "Sign out everywhere else" is the client's `signOut({ scope: 'others' })` |
| `my_data_export()` | One JSON document: `account` (email, providers), `profile`, `membership` (minus RevenueCat payloads), `readingProgress`, `highlights`, `wishlist`, `downloads` (with book titles), `readingDays`, `readingStreak`, `achievements`, `notificationDevices` (minus tokens), `deletionRequests`, `sessions`, `previousExports`. One per 10 minutes (`EXPORT_RATE_LIMITED` with the wait in *details*); each call logged in `data_export_log` |

Password reset and change are Supabase Auth: `resetPasswordForEmail` → the
**Reset password** template (add `{{ .Token }}` so the app can take a code) →
`verifyOtp({ type: 'recovery' })` → `updateUser({ password })`; a signed-in
change is `reauthenticate()` (the **Reauthentication** template, a code to the
account email) → `updateUser({ password, nonce })`. Turn **Secure password
change** on in Auth → Providers → Email so the nonce is enforced server-side.

## Request notes

- **Partial updates.** `profile-update`, `admin-settings`, `admin-book-update`,
  `highlights-upsert`, `reading-progress`, and the category / collection / plan update
  endpoints write only the keys present in the body. Send an explicit `null` to clear a
  field; an empty body returns 400.
- **Both key styles.** `snake_case` and `camelCase` are accepted (`full_name` / `fullName`).
- **Reading progress.** Send `progress` (0–1) *or* `progress_percent` (0–100), never both.
  A `POST` merges: omitted fields keep their stored value, so a background sync that knows
  only the page cannot reset the chapter. Send `chapter_label: ""` to clear the chapter.
  The merge happens in one statement, so two devices syncing at once cannot interleave.
- **Downloads are telemetry.** `downloads-create` records what a device *says* it saved.
  It drives the Downloaded shelf and the admin counter and never gates access; the only
  authority on whether a reader may hold the bytes is `get-signed-pdf`.
- **Avatars.** `POST avatar-upload-url { contentType }` → upload the bytes to the returned
  `signedUrl` → `PUT profile-update { avatar_path }` with the returned `path`.
  `profile-read` returns a signed `avatarUrl` (1 hour) alongside `avatar_path`.
- **Pagination.** `page` / `pageSize` (`limit` is an alias). `pageSize` is capped at 100 and
  the offset is capped at 10,000 rows (`PAGE_OUT_OF_RANGE`); every list sorts on a stable
  key with `id` as the tiebreaker. `books-search` clamps its own limit and offset inside
  `search_books()` as well, so a direct RPC call cannot ask for more.

## Reading position and bookmarks

The reader writes its page in bursts (debounced while flipping, once on close) and queues
those writes while offline. Both tables are owner-only under RLS, so the app's direct
PostgREST fallback keeps working; the Edge Functions add the conflict rule and the
one-call bookmark toggle.

### `reading-progress`

| Call | Returns |
| --- | --- |
| `GET ?book_id=<uuid>` | `{ data: row }`, or `{ data: null }` (200) when the book was never opened. One keyed lookup, no embed. |
| `GET` (no `book_id`) | Every row for the caller, `last_read_at DESC`, paginated, `pageSize` up to 200 (default 100). Call once at launch to hydrate the local cache. |
| `POST` | Upsert on `(user_id, book_id)`; response is **the stored row after the call** plus `applied`. |

Row: `{ id, user_id, book_id, current_page, total_pages, progress, chapter_label, last_read_at, finished_at, created_at, updated_at }`.

```json
{ "book_id": "uuid", "current_page": 42, "total_pages": 310, "progress": 0.135,
  "chapter_label": "optional", "client_updated_at": "2026-09-12T15:22:31+05:00", "tz": "Asia/Karachi" }
```

- **Conflict rule.** `client_updated_at` is optional. When present, the write lands only if
  the stored `last_read_at <= client_updated_at` (equal applies, so replaying the same queue
  entry is idempotent), and `last_read_at` is set to `client_updated_at`. When the stored row
  is newer nothing is written and the response is that row with `applied: false`. When
  absent, the write always lands and `last_read_at = now()` (pre-queue behaviour).
- Any ISO-8601 with an offset or `Z` is accepted and normalised to UTC; more than 24 h in the
  future is a 400. Compare and store in UTC.
- `current_page` exactly one past `total_pages` is clamped to `total_pages` (the PDF view can
  report that for a frame). Two or more past is `INVALID_REQUEST`. The check runs on the
  merged row, so `current_page` sent alone is checked against the stored `total_pages`.
- The merge and the conflict check are one `INSERT … ON CONFLICT … WHERE` inside
  `upsert_reading_progress()`, so two devices syncing at once cannot both win.
- `finished_at` is server-owned: set once, the first time a row's `progress` reaches 0.99, and
  never overwritten or cleared (a reader flipping back to page 1 stays finished). A value sent
  by the client is ignored.
- `tz` (optional IANA name) and the offset on `client_updated_at` decide which calendar day
  the write counts as for the streak — see [Reading record](#reading-record).
- Errors: `AUTH_REQUIRED` 401, `INVALID_REQUEST` 400, `NOT_FOUND` 404 (unknown book),
  `READING_PROGRESS_WRITE_FAILED` / `READING_PROGRESS_READ_FAILED` 500.

### Bookmarks (`highlights`)

A bookmark is a highlight with a `page_number`; the unique index
`highlights_user_book_page_key (user_id, book_id, page_number)` makes it one row per page
(NULL pages — free-text highlights — never collide).

| Call | Body | Returns |
| --- | --- | --- |
| `POST highlights-upsert` | `{ book_id, page_number, note?, color?, text_excerpt? }` | row + `created: true` (201) or `false` (200). Omitted fields keep their value; `""` clears. |
| `POST highlights-upsert` | `{ id, …fields }` | edits that row; moving it onto a page that already has one is `CONFLICT` 409 |
| `POST highlights-toggle` | `{ book_id, page_number }` | `{ bookmarked: boolean, highlight: row \| null }` |
| `POST highlights-delete` | `{ id }` **or** `{ book_id, page_number }` | `{ id, deleted: true }`, or `{ id, deleted: false }` (200) when already gone |
| `GET highlights-list?book_id=` | — | `page_number ASC, created_at ASC`, NULL pages last, `pageSize` up to 200 |

`library-overview.highlights.items[]` carries `page_number`, `note`, `created_at` and the
book card, so the Library can jump straight to the page; `readingProgress` / `finished`
items carry `current_page`, `total_pages`, `progress`, `last_read_at` sorted
`last_read_at DESC`.

## Reading record

The Profile screen's monthly goal, streak sparkline and achievements are computed
server-side and embedded in `profile-read`. Nothing that was there before moved; the three
objects below are additive.

### Timezone

"Today" and "this month" are calendar concepts and the calendar is the reader's, so the zone
travels with the request:

| Call | Zone comes from | Default |
| --- | --- | --- |
| `GET profile-read?tz=Asia/Karachi` | `tz` query param (IANA name) | UTC |
| `POST reading-goal-update { tz }` | `tz` body field | UTC |
| `POST reading-progress` | the numeric offset on `client_updated_at` (`+05:00`); if it is `Z`/absent, the `tz` body field | UTC |

`Z` counts as "no information", not "UTC": JavaScript's `toISOString()` emits `Z` whatever
the device zone. An unknown `tz` is `INVALID_REQUEST` 400. `readingGoal.timezone` echoes
the zone that was actually used. **Send the device zone on every one of these calls** — a
write with no zone is a UTC day, and a 23:30 read in Karachi lands on the wrong day and is
not a night session.

### `profile-read` additions

```json
"streak": {
  "current_streak": 3, "longest_streak": 3, "last_read_date": "2026-09-13",
  "updated_at": "2026-09-13T00:07:28.019832+00:00",
  "recent_days": [
    { "day": "2026-09-07", "read": false, "pages_read": 0 },
    { "day": "2026-09-12", "read": true,  "pages_read": 122 },
    { "day": "2026-09-13", "read": true,  "pages_read": 124 }
  ]
},
"readingGoal": { "target": 4, "completedThisMonth": 1, "month": "2026-09", "timezone": "Asia/Karachi" },
"achievements": [
  { "id": "first-book",   "earned": true,  "earned_at": "2026-09-13T00:10:00+00:00", "progress": { "current": 1, "target": 1 } },
  { "id": "streak-7",     "earned": false, "earned_at": null, "progress": { "current": 3, "target": 7 } },
  { "id": "books-25",     "earned": false, "earned_at": null, "progress": { "current": 1, "target": 25 } },
  { "id": "night-reader", "earned": false, "earned_at": null, "progress": { "current": 1, "target": 5 } }
]
```

- `recent_days` is always exactly seven entries, oldest first, ending on today in the
  resolved zone; days with no read are `read: false, pages_read: 0`.
- `completedThisMonth` counts `reading_progress` rows whose `finished_at` falls in the
  current calendar month of the resolved zone.
- `achievements` is always the same four ids in this order. Labels and icons are the app's;
  the rules are the server's (below). Once earned, an achievement stays earned and
  `earned_at` never changes.
- A user with no reads still gets all three objects: zero streak, seven `read: false` days,
  `completedThisMonth: 0`, four unearned achievements.

### `reading-goal-update`

`POST { "target": 6, "tz": "Asia/Karachi" }` → `{ "data": <readingGoal> }`. `target` must be an
integer 1–100 (`INVALID_REQUEST` 400 otherwise; missing is also 400). Default for every user
is 4. Stored in `profiles.monthly_goal`, which the direct-table fallback can also read.

### Streak and reading days — how they are written

Everything below happens inside one AFTER trigger on `reading_progress`
(`private.record_reading_activity()`), so the RPC, the Edge Function and a direct table write
all behave the same. Nothing is written by the client.

- **A reading day** is any applied `reading_progress` insert or update of
  `last_read_at` / `current_page` / `progress`. A write the conflict rule skipped
  (`applied: false`) is not a read. An update that moves nothing forward and carries no new
  `last_read_at` is not a read either.
- **Day boundary**: the calendar day of the row's `last_read_at` (the client's own timestamp
  when `client_updated_at` was sent, capped at server now) in the request's zone — see the
  timezone table. Without a zone it is the UTC day.
- **Streak rule**: same day as `last_read_date` → no change; the day after → `current_streak + 1`;
  any later day → `current_streak = 1`. `longest_streak = greatest(longest, current)`.
  A day *before* `last_read_date` (an offline entry replayed late) leaves the streak alone but
  still records the day. `current_streak` is only touched by a read, so after a missed day
  it keeps its old value until the next read resets it to 1 — the app can compare
  `last_read_date` with today to show a broken streak.
- **`reading_days`** (`user_id, day, pages_read, sessions, night_sessions`): one row per local
  day; each applied write is `sessions + 1`, `pages_read += max(0, new_page − old_page)`
  (`new_page − 1` on the first write for a book), and `night_sessions + 1` when the local
  time of the write is 23:00–03:59.

### Achievement rules

| id | earned when | `progress.current` | `target` |
| --- | --- | --- | --- |
| `first-book` | ≥ 1 `reading_progress` row with `finished_at` set | finished rows | 1 |
| `streak-7` | `reading_streaks.longest_streak >= 7` | `longest_streak` | 7 |
| `books-25` | ≥ 25 rows with `finished_at` set | finished rows | 25 |
| `night-reader` | ≥ 5 `reading_days` rows with `night_sessions > 0` | such rows | 5 |

Awarded by `private.award_achievements()` right after every streak update, insert-only into
`achievements` (`user_id, achievement_id, earned_at`). `earned_at` is the first / 25th
`finished_at` or the streak's bump time where that is knowable, else the award time.

## Rules for implementation

- Public catalog reads should stay lightweight and paginated.
- Authenticated user endpoints should use `auth.uid()` and row-level policies.
- Admin endpoints should validate `is_admin()` and use RPCs when possible.
- Large or expensive list queries should use page + pageSize and a stable sort key.
- Premium-only actions should run through Edge Functions, not client-side trust.

## App status

`app-status` is the read side of the admin tool's **System → App settings**
(`admin-settings` is the write side). It answers the reader-visible columns of
`app_settings` as the anon role, cached 60 s:

```json
{ "data": { "maintenanceMode": false, "maintenanceMessage": null, "signupEnabled": true,
            "minSupportedVersion": null, "supportEmail": "help@…", "updatedAt": "…" } }
```

The app reads it under the splash and on every return to the foreground, and:

- `maintenanceMode` — replaces the reader app with the notice (`maintenanceMessage`
  or a default). Admins are never gated, so the switch can always be turned off.
- `minSupportedVersion` — a build whose `expo.version` is older is asked to
  update. Unparseable values are ignored by the app. Admins bypass.
- `signupEnabled = false` — the app hides "Create an account"; the database
  refuses new users too, so Google sign-in cannot create one:
  `private.enforce_signups_open()` runs `BEFORE INSERT` on `auth.users`
  (Auth reports it as a database error), and
  `private.before_user_created_hook(event)` answers a clean 403 with the
  sentence when the **Before User Created** hook is enabled on the project
  (Authentication → Hooks → `pg-functions://postgres/private/before_user_created_hook`).
  Closing sign-ups also blocks dashboard invites until reopened.
- `supportEmail` — where the notice's "Contact support" writes to.

`featured_collection_id` is not here: Home takes it from `home-feed`.

## Configured function map

The functions registry is centralized in `supabase/functions/_shared/endpoint-manifest.ts`, and the runtime function toggles are listed in `supabase/config.toml`.

This gives the project a shared contract for future endpoint implementations and keeps the app backend consistent.
