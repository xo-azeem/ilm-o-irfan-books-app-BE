# Mobile app integration prompt — carousel, weekly trending, recommendations

Hand the section below to the mobile app agent verbatim. Everything it describes is already
deployed in this backend and verified end to end against a live Supabase instance.

---

## Task

Three Home-screen features have moved from the app's guesswork to the backend. Wire the app up
to them and delete the client-side logic they replace.

1. **The carousel is now admin-managed.** The app must render exactly what the backend sends,
   in the order it sends it. Remove any code that picks carousel items itself.
2. **Trending is now a weekly draw.** Ten books, chosen at random once a week, identical for
   every user until Monday 00:00 UTC. Remove any client-side shuffling or slicing.
3. **"Because you read …" is now computed, not guessed.** The backend derives it from the
   user's actual reading history and returns the section title already composed. Remove the
   heuristic that captioned an arbitrary book with a "because you read" label.

Base URL is the Supabase functions host: `{SUPABASE_URL}/functions/v1`. Every request needs
the `apikey` header with the anon key. Authenticated endpoints additionally need
`Authorization: Bearer <user access token>`; public ones accept the anon key as the bearer.

### The response envelope (unchanged)

```json
{ "data": ... }                                        // success
{ "error": { "code": "AUTH_REQUIRED", "message": "…" } } // failure
```

Branch on `error.code`, never on `message`. Codes you may see from these three features:
`AUTH_REQUIRED` (401), `FORBIDDEN` (403), `INVALID_REQUEST` (400), `METHOD_NOT_ALLOWED` (405),
`CAROUSEL_READ_FAILED` / `TRENDING_READ_FAILED` / `RECOMMENDATIONS_READ_FAILED` (500).

### The book card shape

Every endpoint below returns books as the **same** snake_case object the app already knows
from `books-list`. Reuse the existing model; do not write a new one.

```
id, slug, title, author_name, author_id, cover_path, cover_color, cover_color_dark,
rating, tag, genre, read_time_minutes, price_cents, currency, format, is_premium, published_at
```

`cover_path` is a storage path, not a URL — resolve it the same way the app already does for
`books-list` cards.

---

## 1. Carousel

### Endpoint

`GET /functions/v1/carousel-list` — public. Also embedded in `home-feed` as a top-level
`carousel` array with the identical payload.

**Fetch it from `home-feed` on the Home screen.** It is the first thing the user sees, and a
separate round trip is a second chance for Home to render half-empty. Call `carousel-list`
only when refreshing the carousel on its own (e.g. pull-to-refresh on just that rail).

### Response

```json
{ "data": { "slides": [ {
  "slide_id": "0e51f6b4-…",
  "sort_order": 0,
  "headline": "Ramadan reads",
  "subtitle": null,
  "image_path": "covers/book-1.jpg",
  "accent": "#1F6F5C",
  "badge": "Featured",
  "cta_label": "Start reading",
  "starts_at": null,
  "ends_at": null,
  "book_id": "cc1219c5-…",
  "slug": "book-1", "title": "Book 1", "author_name": "Al Ghazali",
  "cover_path": "covers/book-1.jpg", "rating": 4.5, "is_premium": false
} ] } }
```

`slides` is `[]` when the admin has not configured anything.

### Rules

- **Render in the order given.** `sort_order` is already applied; do not sort, filter, shuffle
  or top the list up from another source.
- **`headline`, `image_path` and `accent` are already resolved.** The backend has substituted
  the book's `title` / `cover_path` / `cover_color` wherever the admin left an override blank.
  Render them directly; do not re-apply a fallback of your own.
- **`subtitle`, `badge` and `cta_label` are `null` when unset.** Hide the element rather than
  rendering an empty string. `cta_label` is the button text — fall back to your existing
  default label when it is `null`.
- **Tapping a slide opens `book_id`.** The full book card is already in the slide, so navigate
  straight to the book detail screen without an extra fetch.
- **An empty `slides` array means "no carousel".** Hide the rail. Do **not** fall back to
  showing newest books or anything else — an empty carousel is a deliberate admin state, and
  substituting content re-introduces exactly the client-side curation this removes.
- Scheduling and activation are handled server-side. A slide outside its run window, switched
  off, or pointing at an unpublished book simply is not in the response. `starts_at`/`ends_at`
  are informational; do not filter on them.
- Cached `public, max-age=60`. Respect it; do not add cache-busting query parameters.

---

## 2. Weekly trending

### Endpoint

`GET /functions/v1/trending-weekly?limit=10` — public. `limit` defaults to 10, max 50.

Also available as `home-feed` → `shelves.trending` (12 books, no week metadata). Use the
`home-feed` copy for the Home rail; call `trending-weekly` when you need `weekStart` /
`expiresAt`, or on a dedicated "Trending this week" screen.

### Response

```json
{ "data": {
  "weekStart": "2026-09-07T00:00:00.000Z",
  "expiresAt": "2026-09-14T00:00:00.000Z",
  "books": [ /* book cards */ ]
} }
```

### Rules

- **The set is fixed for the week.** Two calls in the same week return the same ten books in
  the same order. Do not shuffle, re-sort, or re-slice — the whole point is that the rail
  stops changing under the user.
- **`expiresAt` is when the current draw stops being current.** Cache the response until then
  rather than polling. It is always the following Monday 00:00 UTC.
- Cached `public, max-age=900`.
- Copy for the rail: "Trending this week" is accurate. Do not label it "picked for you" — it
  is the same list for everybody.
- Fewer than `limit` books is normal for a small catalogue. Render what arrives.

---

## 3. "Because you read …" recommendations

### Endpoint

`GET /functions/v1/recommendations?limit=20&sections=3&perSection=10` — **authenticated**.

| Param | Default | Max | Meaning |
| --- | --- | --- | --- |
| `limit` | 20 | 50 | Total books in the flat `books` list |
| `sections` | 3 | 6 | How many "Because you read X" rails to build |
| `perSection` | 10 | 20 | Books inside each rail |

Home should ask for `sections=3&perSection=10`. A "see all recommendations" screen should ask
for `sections=0&limit=50` and render the flat list.

### Response

```json
{ "data": {
  "generatedAt": "2026-09-07T22:11:44.677Z",
  "isPersonalized": true,
  "sections": [ {
    "id": "seed:342712e6-…",
    "seedBookId": "342712e6-…",
    "reasonType": "author",
    "reasonLabel": "Ibn Sina",
    "title": "Because you read The Book of Healing",
    "subtitle": "More from Ibn Sina",
    "seedBook": { /* book card of the book they read */ },
    "books": [ {
      /* book card */,
      "reason": { "type": "author", "label": "Ibn Sina", "seedBookId": "342712e6-…" }
    } ]
  } ],
  "books": [ /* the same cards, flat and ranked by relevance */ ]
} }
```

### Rules

- **Use `title` and `subtitle` verbatim.** They are composed server-side
  ("Because you read <the actual book they read>" / "More from <that author>"). Do not build
  the caption in the app — that is the bug this replaces.
- **`reasonType` is one of `author`, `genre`, `category`, `tag`, `popular`.** Use it only for
  styling (an icon, a chip colour) if you want; the human-readable text is already in
  `title`, `subtitle`, and each book's `reason.label`.
- **`isPersonalized: false` is the cold-start answer.** A new account with no reading history
  gets `sections: []`, a `books` list of well-rated recent titles, and every `reason.type` set
  to `"popular"`. Render those under a neutral heading — "Popular right now", "Start here" —
  and **never** under "Because you read …". Branch on `isPersonalized`, not on
  `sections.length`.
- **`sections` can be shorter than requested.** A user whose whole history is one author
  legitimately produces one section. Render what arrives.
- **`seedBook` is always present and always a real book the user actually read.** Use it for
  the small "you read this" thumbnail if the design has one.
- **Nothing already read, downloaded or wishlisted appears in the results.** Do not re-filter.
- **Do not cache this response across users, and do not persist it beyond the session.** It is
  per-user and the backend already refreshes it on its own schedule.
- Requires a signed-in user. Anonymous callers get `401 AUTH_REQUIRED` — hide the whole
  section for signed-out users rather than calling and swallowing the error.

### Refresh timing

The backend rebuilds a user's recommendations when their reading signals have moved since the
last build (at most once every 30 minutes), and at least once a day. The app does not need to
trigger anything: **just keep calling `reading-progress` as it already does.** Progress
writes, downloads, wishlist toggles and highlights are all signals, and they feed this
automatically.

Practically: a user who finishes a book will see the rails reflect it on their next Home load
after roughly half an hour. Do not add a "refresh recommendations" button; do not call the
endpoint in a loop hoping for new results.

---

## What to remove from the app

- Any client-side carousel selection (first N books, hard-coded ids, "featured" heuristics).
- Any shuffling, random sampling, or re-slicing of the trending rail.
- Any locally composed "Because you read X" caption, and the logic that chose X.
- Any local fallback that fills an empty carousel with other content.

## What to keep

- The existing `book_list_items` card model and cover-path resolution.
- The existing `reading-progress` sync — it is now also the input to recommendations, so it
  matters more than it did.
- The existing `home-feed` handling of `shelves`. A **missing** `shelves` key still means a
  legacy deployment; the keys are always present now, with `hero` and `newArrivals` empty.

## Suggested Home layout

1. `home-feed` → `carousel` — the admin's rail, top of screen.
2. `home-feed` → `categories`.
3. `recommendations` → `sections` — one rail per "Because you read …", signed-in users only.
4. `home-feed` → `shelves.trending` — "Trending this week".
5. `home-feed` → `books` — "New arrivals".

Home therefore needs **two** requests: `home-feed` (public, cacheable) and, when signed in,
`recommendations`. Fire them in parallel; render the rest of Home if `recommendations` fails.
