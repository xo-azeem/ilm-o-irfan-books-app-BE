# Runbook: storage miss / broken paths

**Severity:** medium — a specific book is unreadable; the rest of the catalog is fine.

## Symptom

`get-signed-pdf` returns `404 PDF_NOT_IN_STORAGE`, a cover renders blank, or a publish is
refused with `400 PDF_NOT_IN_STORAGE`.

## What the error means

The `books` row names a file that the `pdfs` bucket does not have. The two sides drifted:
either the row was written without the upload, or the object was deleted or renamed after.

Publishing now checks the object exists, so a *new* broken publish should be impossible.
Rows published before that check, or objects deleted afterwards, still produce this.

## Find every broken reference at once

```
GET /functions/v1/admin-storage-audit
```

Returns two lists:

- **broken** — books whose `cover_path` / `pdf_path` names a missing object
- **orphans** — objects in a bucket that no book references

## Fix a broken book

Path handling is the usual culprit before anything else. `pdf_path` may be stored with or
without the `pdfs/` prefix; both are normalised, and a leading slash is stripped. What is
*not* tolerated is a different key: a rename, a different folder, or a case difference.

```sql
select id, title, pdf_path, cover_path, is_published from public.books where id = '<book-id>';
select name from storage.objects where bucket_id = 'pdfs' and name ilike '%<part-of-name>%';
```

**If the object exists under another key**, point the row at it:

```
PATCH /functions/v1/admin-book-update  { "id": "<book-id>", "pdf_path": "<actual-key>" }
```

**If the file is genuinely gone**, unpublish the title so readers stop hitting the error,
then re-upload and re-publish:

```
PATCH /functions/v1/admin-book-update  { "id": "<book-id>", "is_published": false }
```

Re-publishing will refuse until the object is back, which is the point.

## Clean up orphans

```
POST /functions/v1/admin-delete-storage-object  { "bucket": "pdfs", "name": "<key>" }
```

This refuses if any book still references the object, so it cannot be the cause of the next
incident. Do the audit first, delete second, and never the other way round.

## Covers specifically

`covers` is a public bucket, so a broken cover is a 404 on a plain URL, not an envelope
error. Check the same way (`admin-storage-audit`), and remember the app caches image URLs —
a fixed cover may need a new key rather than a replacement at the same one to bust caches.

## Avatars

`avatars` is private and owner-scoped: the first path segment must be the user's id or the
RLS policy rejects the write. Mint the key through `avatar-upload-url` rather than
constructing it in the app. `profile-read` returns a signed `avatarUrl` valid for an hour;
an expired one is not an incident, it is the client needing to re-read the profile.

## Prevention

- Upload, then publish. The publish check enforces the order.
- Run `admin-storage-audit` after every bulk import.
- Never delete from the Storage browser without checking `books.pdf_path` first.
