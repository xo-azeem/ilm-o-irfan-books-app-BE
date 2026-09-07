# Production book ingest

Import local book folders into a **linked** Supabase project (Storage + catalog rows).

Related: [`catalog-environments.md`](./catalog-environments.md) (staging vs production data).

## Layout

```text
BOOKS_DIR/
  Ihya Ulum al-Din/
    Ihya Ulum al-Din - Imam Al Ghazali.pdf
    cover.webp                 # optional: cover.jpg / .png
    meta.json                  # optional
```

`meta.json` example:

```json
{
  "isPremium": true,
  "categorySlug": "spirituality",
  "genre": "Spirituality"
}
```

Seeded category slugs: `quranic-studies`, `spirituality`, `history`, `fiqh-law`, `hadith`, `arabic`.

## Prerequisites

1. Project linked (`supabase link` or `npm run deploy:hosted` already done).
2. `.env` has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (upload + DB writes).
3. Seed applied so collections `home-hero`, `trending`, `new-arrivals` exist.
4. Folder path set as `BOOKS_DIR` (no silent wrong default if the path is missing).

## Commands

```bash
# Dry run — scan + write scripts/.import-books.sql only
BOOKS_DIR=D:/Books DRY_RUN=1 npm run books:import

# Real import — Storage upload + SQL apply
BOOKS_DIR=D:/Books npm run books:import

# Default every book to premium unless meta says otherwise
BOOKS_DIR=D:/Books DEFAULT_IS_PREMIUM=1 npm run books:import
```

On Windows PowerShell:

```powershell
$env:BOOKS_DIR='D:/Books'
npm run books:import
```

## After import

1. Publish gate: books only publish when cover + PDF objects exist (`book_publish_blocker()`).
2. Run storage audit (admin JWT or SQL as service role):

```bash
# via Edge Function (admin session)
# GET /functions/v1/admin-storage-audit

# or SQL
select * from public.admin_storage_audit();
```

3. Fix orphans / broken paths with `admin-delete-storage-object` / `admin_delete_storage_object`.
4. Smoke: `npm run smoke:hosted` — `home-feed` shelves should show membership once collections are joined.
5. Verify a few `coverUrl` values load in app-sized cards.

## Staging vs production

Same migrations and import script; different `BOOKS_DIR` content and project refs. Never point production service role at a staging folder by mistake.

## Related

- Script: `scripts/import-folder-books.mjs`
- Deploy checklist: [`deploy-checklist.md`](./deploy-checklist.md)
- FE INP→PDF handoff (when used): FE repo `docs/inp-to-pdf-conversion.md` → Storage `pdfs/…`
