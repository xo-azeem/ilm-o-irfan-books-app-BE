# Sample books (staging ingest)

Tiny PDF + 1×1 PNG fixtures for `npm run books:import` when you do not have a full `BOOKS_DIR` yet.

```bash
node scripts/create-sample-books.mjs
BOOKS_DIR=fixtures/sample-books npm run books:import
```

Creates:

| Folder | Premium |
| --- | --- |
| Sample Free Book | no |
| Sample Premium Book | yes |

Regenerate anytime; import upserts by slug.
