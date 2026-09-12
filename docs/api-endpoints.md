# API endpoint plan

This project is built on Supabase + PostgreSQL, so most app endpoints will either map to:

- Supabase table queries with RLS
- Edge Functions for privileged logic
- RPCs for admin or deep business actions

## Public endpoints

The Edge Function endpoint base is `/functions/v1/...`.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/functions/v1/home-feed` | GET | Public | Collections, categories, newest books, `carousel`, `shelves.hero` / `trending` / `newArrivals`, `featuredCollectionId`, `supportEmail` (book cards include `coverUrl`) — see [Home shelves](#home-shelves) |
| `/functions/v1/books-list` | GET | Public | Paginated published books — see [Discover filters](#discover-filters) |
| `/functions/v1/book-detail?id=<bookId>` | GET | Public | Book detail with author and metadata (`coverUrl`; no `pdf_path`) |
| `/functions/v1/books-search?q=<query>` | GET | Public | Prefix search, plus the same [Discover filters](#discover-filters) as `books-list` |
| `/functions/v1/categories-list` | GET | Public | Browse categories |
| `/functions/v1/collections-list` | GET | Public | Returns collections and shelves |
| `/functions/v1/collection-books?id=` or `?slug=` | GET | Public | Paginated books in one published collection (`sort_order`) |
| `/functions/v1/plans-list` | GET | Public | Plan catalog for premium screen |
| `/functions/v1/carousel-list` | GET | Public | The admin-curated home carousel — see [Home carousel](#home-carousel) |
| `/functions/v1/trending-weekly?limit=10` | GET | Public | Ten books drawn at random once a week — see [Weekly trending](#weekly-trending) |

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

`home-feed` returns three rails under `shelves`. The app renders them verbatim — it does
not re-sort them or top them up — so what the backend puts there is exactly what Home shows.

| Rail | Source | Empty-source fallback |
| --- | --- | --- |
| `hero` | `collections.slug = 'home-hero'`, in `sort_order` | 5 newest published books |
| `trending` | `weekly_trending_books(12)` — see [Weekly trending](#weekly-trending) | none needed |
| `newArrivals` | `collections.slug = 'new-arrivals'`, in `sort_order` | 12 newest published books |

`hero` and `newArrivals` are editorial shelves and keep their fallback, so Home is never
blank while `collection_books` is unpopulated. `trending` is the one rail that claimed to
describe the catalogue rather than an editor's taste, so it is now the weekly draw and needs
no fallback: the draw already covers everything published.

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

## Rules for implementation

- Public catalog reads should stay lightweight and paginated.
- Authenticated user endpoints should use `auth.uid()` and row-level policies.
- Admin endpoints should validate `is_admin()` and use RPCs when possible.
- Large or expensive list queries should use page + pageSize and a stable sort key.
- Premium-only actions should run through Edge Functions, not client-side trust.

## Configured function map

The functions registry is centralized in `supabase/functions/_shared/endpoint-manifest.ts`, and the runtime function toggles are listed in `supabase/config.toml`.

This gives the project a shared contract for future endpoint implementations and keeps the app backend consistent.
