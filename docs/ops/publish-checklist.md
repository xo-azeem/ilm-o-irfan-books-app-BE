# Publish checklist

A book is safe to show in the catalog only when all of the following hold. The CMS publish gate enforces PDF presence in Storage; the rest is ops discipline (import script + `admin-storage-audit`).

## Before `is_published = true`

| Check | Why |
| --- | --- |
| **PDF** in bucket `pdfs` at `pdf_path` | Reader hits `PDF_NOT_IN_STORAGE` otherwise; `book_publish_blocker()` / `assertPublishable` block publish |
| **Cover** in bucket `covers` at `cover_path` (recommended) | Home/Search cards look broken; import warns when missing; set `REQUIRE_COVER=1` to fail the import |
| **Author** set (`author_id`) | Detail and search by author |
| **Category** membership (`book_categories`) | Search chips / browse |
| **Collection** membership for Home shelves | `home-hero` / `trending` / `new-arrivals` as needed |
| **Stable slug** | Folder name or `meta.slug`; never change a live slug casually (breaks deep links) |
| **`is_premium` correct** | Catalogue label and the `premium` Discover filter. Does **not** drive access — `get-signed-pdf` requires an entitlement for every book. Defaults to `true` |

## After bulk import

```bash
BOOKS_DIR=D:/Books npm run books:import
# Then (admin JWT):
# GET /functions/v1/admin-storage-audit
```

Expect zero broken paths and no unexpected orphans.

## Collection `kind`

| Kind | Use |
| --- | --- |
| `hero` | Featured / banner shelf (seed: `home-hero`) |
| `shelf` | Horizontal rows (`trending`, `new-arrivals`, …) |
| `carousel` | Rotating seasonal strips (seed: `ramadan-reading`) |

Invalid kinds are rejected by `admin_upsert_collection` / CMS create (`400`).

## Soft-delete

v1 uses **hard delete** (`admin-book-delete` returns storage paths to purge). There is no soft-delete column.

## Related

- [`books-ingest.md`](./books-ingest.md)
- [`media-budgets.md`](./media-budgets.md)
- [`catalog-environments.md`](./catalog-environments.md)
