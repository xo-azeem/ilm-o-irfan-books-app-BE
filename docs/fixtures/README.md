# API response fixtures

Frozen example envelopes for the React Native app team. Shape matches live Edge Functions:

- Success single: `{ "data": { ... } }`
- Success list: `{ "data": [ ... ], "page", "pageSize", "totalCount", ... }`
- Failure: `{ "error": { "code", "message" } }`

Full mobile contract: [`../mobile-contract.md`](../mobile-contract.md).

| File | Endpoint |
| --- | --- |
| `home-feed.response.json` | `GET /functions/v1/home-feed` (includes `carousel` + shelves) |
| `carousel-list.response.json` | `GET /functions/v1/carousel-list` |
| `trending-weekly.response.json` | `GET /functions/v1/trending-weekly` |
| `recommendations.response.json` | `GET /functions/v1/recommendations` (user) |
| `book-detail.response.json` | `GET /functions/v1/book-detail` |
| `collection-books.response.json` | `GET /functions/v1/collection-books` |
| `entitlements-status.response.json` | `GET /functions/v1/entitlements-status` (lifecycle + realtime) |
| `get-signed-pdf.response.json` | `POST /functions/v1/get-signed-pdf` (success + `access`) |
| `get-signed-pdf.premium-required.json` | `POST /functions/v1/get-signed-pdf` (403) |
| `get-signed-pdf.not-in-storage.json` | `POST /functions/v1/get-signed-pdf` (404) |
| `revenuecat-webhook.auth-failed.json` | `POST /functions/v1/revenuecat-webhook` (401) |
| `revenuecat-webhook.app-store.initial-purchase.request.json` | Inbound RC body (`APP_STORE` / `INITIAL_PURCHASE`) |
| `revenuecat-webhook.play-store.initial-purchase.request.json` | Inbound RC body (`PLAY_STORE` / `INITIAL_PURCHASE`) |
| `revenuecat-webhook.app-store.applied.response.json` | Webhook success (`store: app_store`) |
| `revenuecat-webhook.play-store.applied.response.json` | Webhook success (`store: play_store`) |
| `revenuecat-webhook.renewal.request.json` | Inbound RC body (`RENEWAL`) |
| `revenuecat-webhook.cancellation.request.json` | Inbound RC body (`CANCELLATION`, paid-through) |
| `revenuecat-webhook.expiration.request.json` | Inbound RC body (`EXPIRATION`) |
| `revenuecat-webhook.billing-issue.request.json` | Inbound RC body (`BILLING_ISSUE`) |
| `library-overview.response.json` | `GET /functions/v1/library-overview` |
| `profile-read.response.json` | `GET /functions/v1/profile-read` |
| `reading-progress.response.json` | `POST /functions/v1/reading-progress` |
| `avatar-upload-url.response.json` | `POST /functions/v1/avatar-upload-url` |
| `admin-audit-log.response.json` | `GET /functions/v1/admin-audit-log` (list envelope) |
| `books-list.page-out-of-range.json` | any list endpoint paged past the offset ceiling |

## Contract notes for the app

- Gate premium UI on `canAccessPremium`, not only `isActive`.
- Use `coverUrl` for cover images; fall back to `cover_color` when null.
- `progress` is 0–1. Send `progress_percent` if you have 0–100; never both.
- A `POST /reading-progress` merges — omitting `chapter_label` keeps the stored one, and
  `""` clears it. Omitting `current_page` does not reset it to page 1.
- Avatars: `avatar-upload-url` → upload → `profile-update { avatar_path }`. Render from the
  signed `avatarUrl` in `profile-read`, which expires after an hour.
- List endpoints stop at 10,000 rows of offset and answer `PAGE_OUT_OF_RANGE` past that.
- `book-detail` never includes `pdf_path` — open files via `get-signed-pdf`.
- `books-list?category=<uuid-or-slug>` filters the catalog for Search chips.
- `collection-books` returns list pagination plus a `collection` meta object.
  `totalCount` / paging only include **published** membership (drafts in the
  junction table do not inflate the count or eat offset slots).

These files are the frozen v1 contract. A change to any of them is a change to the app.
