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

Gate premium UI on `canAccessPremium`, not only `isActive`.
