# Rule: Frontend-aligned backend

**File:** `.cursor/rules/frontend-aligned-backend.mdc`  
**Scope:** Always applied in this repo  
**Purpose:** Make every backend change driven by the React Native app and the backend stack doc.

## What this rule does

When you ask the agent to add or change backend pieces (schema, auth, storage, Edge Functions, seed data, etc.), it must:

1. Open and inspect the companion frontend at `D:\Projects\Ilm-o-Irfan-App-FE` to learn screens, data shapes, and expected API behavior.
2. Follow `docs/backend-stack.md` (copied from the FE docs) for Supabase/Postgres/Auth/Storage/RevenueCat design.
3. Create only what is needed for the request, keeping FE ↔ BE contracts aligned.

## Why it exists

This backend exists to serve **Ilm o Irfan** — an Islamic e-book React Native app (catalog, reader, offline downloads, auth, subscriptions). The UI already lives in the FE repo; this BE repo holds Supabase project assets (migrations, RLS, Edge Functions, config) that the app will call.

## Related paths

| Resource | Location |
| --- | --- |
| Frontend app | `D:\Projects\Ilm-o-Irfan-App-FE` |
| Backend stack & cost guide | `docs/backend-stack.md` |
| FE copy of the same guide | `D:\Projects\Ilm-o-Irfan-App-FE\docs\backend-stack.md` |
| Cursor rule | `.cursor/rules/frontend-aligned-backend.mdc` |

## How to use it

Just ask in natural language, for example:

- “Create the Postgres schema for books and authors”
- “Add the signed PDF Edge Function”
- “Wire auth profiles to match the Login screen”

The agent will check the FE and the stack doc, then implement in this repo.
