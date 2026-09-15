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

### Send `x-region: ap-southeast-1` on every Edge Function call

Edge Functions run as per-region isolates and cold-start at ~1.3–1.8s after a few
minutes idle. The backend keeps the launch-path functions warm with a scheduled pinger —
but that pinger runs from the database in Singapore (`ap-southeast-1`) and can only warm
Singapore. A phone in Pakistan is routed to Mumbai (`ap-south-1`) by default, where
nothing is warm.

Pinning every request to `ap-southeast-1` costs ~30ms on a warm call (measured: 320ms vs
350ms for `home-feed`) and removes the cold start entirely. Set it as a default header on
the Edge Function client, not per call:

```ts
const fn = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    ...init,
    headers: { ...init.headers, 'x-region': 'ap-southeast-1', apikey: ANON_KEY },
  })
```

This is also where the database lives, so a Singapore isolate reaches it locally instead
of crossing from Mumbai on every query.

---

## Screen → route map

| Screen | Method | Route | Auth |
| --- | --- | --- | --- |
| Home | GET | `/functions/v1/home-feed` | Public |
| Home carousel (standalone) | GET | `/functions/v1/carousel-list` | Public |
| Weekly trending | GET | `/functions/v1/trending-weekly` | Public |
| Recommendations | GET | `/functions/v1/recommendations` | User |
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

`collection-books` paginates only **published** books. Draft / missing titles still listed in `collection_books` do not count toward `totalCount` or consume page offset. The response carries `source` (`curated` | `weekly` | `newest`): `slug=trending` pages this week's draw, `slug=new-arrivals` pages curated members or, when there are none, every published book newest-first.

| Collections strip | GET | `/functions/v1/collections-list` | Public |

`collections-list` (and `home-feed.collections`) lists admin-made collections only; `home-hero`, `trending` and `new-arrivals` are rails on Home and are excluded. Rows carry `is_system` (always `false` there).

| Book detail | GET | `/functions/v1/book-detail?id=<uuid>` | Public |
| Reader open / download | POST | `/functions/v1/get-signed-pdf` body `{ "bookId" }` | User |
| Progress sync | GET/POST | `/functions/v1/reading-progress` (`?book_id=` for one row; list for launch hydrate) | User |
| Library | GET | `/functions/v1/library-overview` | User |
| Wishlist | GET/POST | `wishlist-list` / `wishlist-toggle` | User |
| Downloads | GET/POST | `downloads-list` / `downloads-create` | User |
| Highlights / bookmarks | GET/POST | `highlights-list` / `highlights-upsert` / `highlights-toggle` / `highlights-delete` | User |
| Profile | GET/PUT | `profile-read?tz=` / `profile-update` — `readingGoal`, `streak.recent_days`, `achievements` | User |
| Monthly reading goal | POST | `reading-goal-update` `{ target }` | User |
| Avatar | POST | `avatar-upload-url` then upload then `profile-update` | User |
| Subscription status | GET | `entitlements-status` | User |
| Plan catalog | GET | `plans-list` | Public |
| Login / Sign up | — | Supabase Auth: `signInWithPassword` / `signUp` (not an Edge Function) | — |
| Google sign-in | — | Native Google ID token → `signInWithIdToken({ provider: 'google', token })`. Same verified email as email/password = one user (automatic linking). Optional: `linkIdentity` when already signed in. | — |
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

`shelves.trending` is this week's random draw (first 10); `shelves.newArrivals` is the `new-arrivals` collection's curated members or, when empty, the 10 newest published books; `shelves.hero` is the curated `home-hero` shelf with a newest-books fallback. `trending` and `newArrivals` are the first page of what `collection-books?id=<shelvesMeta.*.collectionId>` returns, so "See all" opens the same list. `shelvesMeta.{trending,newArrivals}` = `{ collectionId, slug, totalCount, source }`; `collectionId` is `null` when the admin unpublished that shelf (rail is `[]`) or the read degraded.

- `progress` is a fraction **0.0–1.0**.
- Or send `progress_percent` **0–100**. Never both.
- `POST /reading-progress` merges: omitted fields stay unchanged; `chapter_label: ""` clears.
- Send `client_updated_at` (ISO-8601) with every progress write. If the stored `last_read_at`
  is newer the write is skipped and the response says `applied: false` — the row returned is
  the one to cache. Without it the write always lands (legacy behaviour).
- `current_page` one past `total_pages` is clamped to the last page; two or more past is a 400.
- `GET /reading-progress?book_id=<uuid>` is `{ data: null }` (200) for a book never opened.
- Bookmarks: one row per `(book_id, page_number)`. `highlights-toggle { book_id, page_number }`
  → `{ bookmarked, highlight }`. `highlights-delete` on a missing row is `{ deleted: false }` (200).
- Finished shelf: `progress >= 0.99`.

---

## Premium gate

`GET entitlements-status` →

```jsonc
{ "data": {
    "isActive": true,            // the subscription alone
    "isAdmin": false,            // profiles.role or the app_role JWT claim
    "canAccessPremium": true,    // isActive || isAdmin  <- gate on THIS
    "entitlement": { /* row + nested plan */ },

    "status": "active",          // active|trial|cancelled|grace|billing_issue|expired
    "startsAt": "2026-09-09T12:00:00Z",
    "expiresAt": "2026-10-09T12:00:00Z",   // null = no end date (lifetime / admin)
    "secondsRemaining": 2592000,           // null when expiresAt is null; never negative
    "reason": "active",
    "serverTime": "2026-09-09T12:00:00Z",  // for clock-skew correction

    "realtime": { "mode": "postgres_changes", "channel": "access:<user_id>",
                  "schema": "public", "table": "access_events", "event": "INSERT",
                  "filter": "user_id=eq.<user_id>" } } }
```

`reason` tells the paywall what to say. `active` · `trial` · `cancelled_paid_through` ·
`grace` · `billing_issue_paid_through` · `admin` · `lapsed` · `expired` · `none`.
Never having subscribed (`none`) deserves a different screen from a failed card
(`billing_issue_paid_through`, still reading) or a lapse (`lapsed`).

**Do not read `status` to decide access.** `trial`, `cancelled` (will not renew, but paid
through the month), `grace` and `billing_issue` all still grant it. `canAccessPremium` is
the only field that decides.

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

### When the subscription ends mid-read

Access ends **exactly** at `expiresAt`, not at the end of the session, and not when the
next request happens to go out. Three layers make that true, and the app owns one of them.

| Layer | Owner | Role |
| --- | --- | --- |
| `get-signed-pdf` re-checks every open | backend | Truth. Refuses the instant `expiresAt` passes. |
| Minutely sweep → Realtime broadcast | backend | Pushes the change out, within ~60s. |
| **Countdown to `expiresAt`** | **app** | **Exactness. Locks to the second, offline, with no socket.** |

**The socket is not the lock.** Build the timer first. If the broadcast were the only
mechanism, turning off wifi one second before expiry would buy unlimited reading — and
that is the one thing this whole feature exists to prevent.

Subscribe using the `realtime` block from `entitlements-status` — **Postgres Changes on
`public.access_events`**, filtered to this reader:

```ts
const rt = state.realtime   // { mode, channel, schema, table, event, filter }

supabase
  .channel(rt.channel)
  .on('postgres_changes',
      { event: rt.event, schema: rt.schema, table: rt.table, filter: rt.filter },
      ({ new: row }) => applyAccessState(row))
  .subscribe()
```

Each row is the computed answer, in snake_case:

```jsonc
{ "user_id": "...", "can_access_premium": false, "is_active": false,
  "is_admin": false, "status": "expired", "expires_at": null,
  "reason": "expired", "seconds_remaining": 0, "server_time": "...",
  "created_at": "..." }
```

Same fields as the `entitlements-status` body, so one reducer handles both — just note
this side is snake_case while `entitlements-status` is camelCase.

The table is **read-only and RLS-scoped to one reader**: another reader's rows are
invisible, `anon` is refused outright, and a device cannot insert itself an unlock. It
carries no billing internals — no `raw_event`, no `store`, no plan ids.

Take the whole subscription shape from the `realtime` block rather than hardcoding it. The
delivery mechanism has already changed once and the block exists so apps in the field
follow without a release.

Rules that matter:

- **Correct for clock skew.** Store `serverTime - Date.now()` at every sync and apply the
  offset to the countdown. Otherwise moving the device clock backwards buys free reading.
- **`get-signed-pdf` re-anchors it.** Every successful open returns `access.expiresAt`,
  `access.secondsRemaining` and `access.serverTime`. Re-arm the timer from those.
- **Re-check on foreground**, always. Expiry that happens while backgrounded produces no
  timer callback you can rely on.
- **Signed URLs are clamped** to the remaining subscription — a reader with 40 seconds left
  gets a ~40s URL, not the usual 300s. Do not assume `expiresIn` is constant.
- **Locking is not deleting.** Keep reading progress, highlights and download rows. A
  reader who resubscribes should find their library exactly as they left it.
- A **renewal** arriving seconds after a lapse broadcasts an unlock. Let the paywall
  recover from that without a restart rather than tearing down state on lock.

`downloads-list` rows survive expiry on purpose. A downloaded file on disk is **not**
permission to open it — gate the reader screen on `canAccessPremium`, never on file
presence.

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
- Plan rows also expose `app_store_product_id`, `play_store_product_id`, and `revenuecat_product_id` for ops/debug — **do not** use them as the charge amount. Checkout uses RevenueCat’s localized store price; Apple Pay / Google Pay appear inside the App Store / Play purchase sheet when the user’s device supports them.
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
