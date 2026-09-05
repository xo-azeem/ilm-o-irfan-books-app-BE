# API response fixtures

Frozen example envelopes for the React Native app team. Shape matches live Edge Functions:

- Success single: `{ "data": { ... } }`
- Success list: `{ "data": [ ... ], "page", "pageSize", "totalCount", ... }`
- Failure: `{ "error": { "code", "message" } }`

| File | Endpoint |
| --- | --- |
| `home-feed.response.json` | `GET /functions/v1/home-feed` |
| `book-detail.response.json` | `GET /functions/v1/book-detail` |
| `entitlements-status.response.json` | `GET /functions/v1/entitlements-status` |
| `get-signed-pdf.response.json` | `POST /functions/v1/get-signed-pdf` (success) |
| `get-signed-pdf.premium-required.json` | `POST /functions/v1/get-signed-pdf` (403) |
| `library-overview.response.json` | `GET /functions/v1/library-overview` |
| `profile-read.response.json` | `GET /functions/v1/profile-read` |
| `reading-progress.response.json` | `POST /functions/v1/reading-progress` |
| `avatar-upload-url.response.json` | `POST /functions/v1/avatar-upload-url` |
| `admin-audit-log.response.json` | `GET /functions/v1/admin-audit-log` (list envelope) |
| `books-list.page-out-of-range.json` | any list endpoint paged past the offset ceiling |

## Contract notes for the app

- Gate premium UI on `canAccessPremium`, not only `isActive`.
- `progress` is 0–1. Send `progress_percent` if you have 0–100; never both.
- A `POST /reading-progress` merges — omitting `chapter_label` keeps the stored one, and
  `""` clears it. Omitting `current_page` does not reset it to page 1.
- Avatars: `avatar-upload-url` → upload → `profile-update { avatar_path }`. Render from the
  signed `avatarUrl` in `profile-read`, which expires after an hour.
- List endpoints stop at 10,000 rows of offset and answer `PAGE_OUT_OF_RANGE` past that.

These files are the frozen v1 contract. A change to any of them is a change to the app.
