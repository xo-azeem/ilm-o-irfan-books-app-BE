# FE ↔ BE parity audit

**Date:** 2026-09-06  
**Branch:** `feat/mobile-api-parity` (from `origin/dev`)  
**Frontend:** `D:\ilm-o-irfan-books-app` (mock shell)  
**Backend:** this repo  
**Process:** Azeem — audit thoroughly, document to industry standard, parity-check the app against the codebase, then implement missing mobile APIs. FE wiring is out of scope here.

Companion contract (what the phone should call): [`docs/mobile-contract.md`](../mobile-contract.md).

---

## Executive summary

The backend already covers catalog, auth bootstrap, library, signed PDFs, entitlements, and admin CMS. The React Native app is still a **mock shell**: no Supabase client, no RevenueCat SDK, auth is a boolean in MMKV, and the reader always opens one bundled PDF.

Almost every screen has a matching Edge Function. Three holes would block plugging mocks out:

| Rank | Gap | Kind | Status on this branch |
| --- | --- | --- | --- |
| 1 | Search category dropdown has no API filter | API missing | `GET books-list?category=` |
| 2 | Curated collection tap has no membership endpoint | API missing | `GET collection-books` |
| 3 | Cards return `cover_path` only | Contract drift | computed `coverUrl` on book payloads |
| 4 | Fixtures lagged live handlers (`pdf_path` on detail) | Contract drift | fixtures aligned |
| 5 | `reading-progress` POST omitted from the manifest | Contract drift | documented |

Naming mismatches (camelCase mocks vs snake_case API) are **documented, not renamed**.

---

## Screen vs endpoint

| Screen (FE) | Mock source | Backend call | Fit |
| --- | --- | --- | --- |
| Home | `exploreContent` hero / trending / newArrivals / collections | `GET home-feed` | Shelves exist. Collection cards had no membership GET until `collection-books`. |
| Search (all books) | `searchCatalogBooks` | `GET books-list` / `GET books-search?q=` | Search bar is a placeholder; API is ready. |
| Search (category chip) | `categories` local state, does not filter | `GET books-list?category=` | Was missing; added. |
| Book detail | `getBookById` | `GET book-detail?id=` | Ready. Gate Read/Buy with `entitlements-status`. |
| Reader | bundled `default-book.pdf` | `POST get-signed-pdf` then device FS | FE still bundled. Progress: `POST reading-progress`. |
| Library | `libraryContent` | `GET library-overview` | Shelves map (see below). Wishlist screen exists but is not in the navigator. |
| Profile | `profileContent.profileUser` | `GET profile-read` + `GET entitlements-status` | Initials / memberSince / plan are client-derived. |
| Personal details | in-memory form | `PUT profile-update` | Email is Auth-owned. |
| Subscription | `subscriptionPlan` | `GET plans-list` + `entitlements-status` | Purchases go through RevenueCat, not an Edge Function. |
| Downloads | `downloadedBooks` | `GET downloads-list` / `POST downloads-create` | Metadata only; bytes live on device. |
| Login / Sign up | `authStore.signIn()` | Supabase Auth SDK | Not an Edge Function. Google needs Dashboard config. |
| Appearance / Language / Notifications / Privacy | local | none | MMKV only (v1). |
| Help / About / Rate | static copy | none | Optional later: `app_settings.support_email`. |
| Admin | none | admin `*` functions | Consumer app has no CMS. Azeem / ops. |

### Library shelf map

| FE shelf label | Backend |
| --- | --- |
| Saved | `library-overview.wishlist` / `wishlist-list` |
| Wishlist | same (`wishlist-toggle`) |
| Downloaded | `downloads` |
| Highlights | `highlights` |
| Finished | `finished` (`progress >= 0.99`) |
| History / Continue | `readingProgress` ordered by `last_read_at` |

---

## Gaps ranked

### API missing (this branch)

1. **Category filter** — Search UI selects a category id; `books-list` listed the whole catalog.
2. **Collection books** — Home curated collections have `id` / `title` / `bookCount` but no public ordered membership GET. `home-feed` only hydrates `home-hero`, `trending`, `new-arrivals`.

### Contract drift (this branch)

3. **Cover URLs** — FE uses color placeholders today; real covers need a public Storage URL. The phone must not invent `/storage/v1/object/public/covers/...` rules.
4. **Fixtures vs live** — `book-detail` fixture leaked `pdf_path` (handler never selects it). `home-feed` fixture used lean cards instead of `book_list_items`.
5. **Manifest** — `reading-progress` is GET+POST in the handler; the manifest listed GET only.

### FE-only (Azeem)

- Add `@supabase/supabase-js` + MMKV session adapter.
- Replace mocks on Home, Search, Detail, Library, Profile, Subscription.
- Reader: signed URL → blob util → `react-native-pdf`; POST progress; download CTA → `downloads-create`.
- Register `WishlistScreen` in the navigator.
- Map Lucide `icon` from `categories.icon_key`.
- Format `read_time_minutes` → `"4 hr read"`; compute `timeLeft` from remaining progress.
- Flip-page animation.

### Ops (not code)

- Hosted project link / `db push` / `functions deploy` (ilmoirfan Google account).
- Google OAuth in Dashboard + deep links.
- RevenueCat project, store products, webhook secret.
- Fill collection membership so `home-feed.shelves` is not a newest-books fallback.
- Premium sample books so the paywall can be exercised.

---

## Field mismatches (keep API snake_case)

| FE mock | API |
| --- | --- |
| `author: string` | `author_name` (lists) or `author.name` (detail) |
| `coverColor` / `coverColorDark` | `cover_color` / `cover_color_dark` |
| `readTime: "4 hr read"` | `read_time_minutes` (number; format on client) |
| `price` float / `$` | `price_cents` + `currency` |
| `hero-1` ids | UUIDs |
| `chapter` / `timeLeft` | `chapter_label`; `timeLeft` client-computed |
| `dateOfBirth` | `date_of_birth` |
| editable email | Auth-owned |
| `renewsOn` | `entitlements.expires_at` |
| `plan: "Premium"` | `canAccessPremium` + nested `entitlement.plan` |
| `initials` / `memberSince` | derive from `full_name` / `created_at` |
| `count: "24 books"` string | `book_count` number |
| category `icon: LucideIcon` | `icon_key` string |

---

## Security notes (unchanged, still required)

- Never ship `service_role` in the app. Anon key + user JWT only.
- Never client-write `entitlements`.
- Never call deprecated `POST signed-pdf` (410). Use `get-signed-pdf`.
- Gate premium UI on `canAccessPremium`, not `isActive`.
- `pdf_path` is not on public detail payloads on purpose.

---

## Non-goals

- Wiring the React Native app.
- Flip animation.
- Google OAuth / RevenueCat Dashboard work.
- Merging to `main`.
- CamelCasing the API.
- Redis, custom Node API, audio streaming, in-app admin CMS.
