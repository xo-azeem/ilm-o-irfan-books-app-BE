# Ilm o Irfan — Backend

Supabase backend for the **Ilm o Irfan** React Native books app.

## Companion frontend

`D:\Projects\Ilm-o-Irfan-App-FE`

## Stack

| Layer | Technology |
| --- | --- |
| Platform | Supabase |
| Database | PostgreSQL |
| Auth | Supabase Auth (email + Google) |
| Files | Supabase Storage (`covers`, `pdfs`, `avatars`) |
| Privileged logic | Supabase Edge Functions |
| Subscriptions | RevenueCat + App Store / Play |

Full design, schema, RLS, and cost notes: [`docs/backend-stack.md`](docs/backend-stack.md).

## Agent guidance

Cursor rules live in [`.cursor/rules/`](.cursor/rules/). See [`.cursor/rules/DESCRIPTION.md`](.cursor/rules/DESCRIPTION.md).

When implementing features, inspect the frontend and follow the backend stack doc.
