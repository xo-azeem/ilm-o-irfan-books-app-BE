# Media budgets (PDF + covers)

Guidelines for catalog files so staging/production stay inside Supabase Storage and egress limits. See also [`backend-stack.md`](../backend-stack.md) pricing notes.

## PDF size

| Limit | Value | Enforced by |
| --- | --- | --- |
| Soft warn | **25 MB** | `books:import` (`WARN_PDF_BYTES`) |
| Hard fail | **80 MB** | `books:import` (`MAX_PDF_BYTES`) |
| Reader TTL | **300 s** signed URL | `SIGNED_PDF_EXPIRES_IN` (default 300) |

Targets for a good reader experience:

- Prefer **2–15 MB** per title after compression.
- Above ~25 MB, compress (downsample images, linearize PDF) before import.
- Never publish a multi-hundred-MB scan as-is — one viral title burns Free/Pro egress.

Override on import:

```bash
MAX_PDF_BYTES=104857600 WARN_PDF_BYTES=20971520 BOOKS_DIR=D:/Books npm run books:import
```

## Covers

| Guidance | Detail |
| --- | --- |
| Format | `cover.webp` preferred; `jpg` / `png` accepted |
| Size | Aim **&lt; 500 KB**; typical card art ~200–400 KB |
| Path | Storage bucket `covers` → public URL `/object/public/covers/…` |
| Cache | Public objects are CDN-friendly on Supabase (Smart CDN on Pro). Clients should treat `coverUrl` as cacheable; do not re-download every Home paint if the app already has a local copy |

There is **no** client `SELECT` policy on `covers` that would allow listing the bucket; only known object URLs work. Same for `pdfs` — PDFs are never public; only short-lived signed URLs from `get-signed-pdf`.

## Signed PDF URLs

- Default TTL **300 seconds** — long enough to start a download / open the reader, short enough not to be a shareable link.
- Response includes `expiresIn` so the app can refresh before expiry.
- Bucket `pdfs` must stay private (no anon/authenticated SELECT policy). Confirmed in `scripts/e2e-endpoints.sh` RLS block and `npm run smoke:rls`.

## Egress posture (v1)

- Covers: public + CDN/cached egress where available.
- PDFs: uncached signed downloads; budget catalog size × active readers.
- No Redis for media in v1 — measure Edge cold-start and only add caching if Home splash proves too slow.

## Related

- Import: [`books-ingest.md`](./books-ingest.md)
- Publish gate: [`publish-checklist.md`](./publish-checklist.md)
- Storage miss runbook: [`../runbooks/storage-miss.md`](../runbooks/storage-miss.md)
