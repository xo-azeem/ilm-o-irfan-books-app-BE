# Staging vs production catalog

Same **schema and Edge Functions**; different **data and secrets**.

| Concern | Staging | Production |
| --- | --- | --- |
| Project ref | `rwnmckrepvycydmtgvcq` (current) | New project — never reuse staging |
| Migrations | `db push` from this repo | Same migration history |
| Seed users | `admin@` / `test@` OK | Real admin only; no shared test passwords |
| Books | Sample + import from `BOOKS_DIR` / fixtures | Real catalog only; re-run import or CMS |
| Storage paths | Same conventions (`covers/…`, `pdfs/…`) | Separate buckets (project-scoped) |
| `REVENUECAT_WEBHOOK_AUTH` | Placeholder or sandbox secret | Rotated production secret |
| Entitlements | Promotional comps OK | Prefer RC; comps via `admin-set-entitlement` with audit |

## Promotion checklist

1. Create production Supabase project → copy ref into a **separate** `.env.production` (never commit).
2. `DEPLOY_SEED=0` (or omit) for first prod deploy unless you intentionally want seed shelves only.
3. `DEPLOY_ALLOW_PLACEHOLDER_RC=0` — real `REVENUECAT_WEBHOOK_AUTH` required.
4. Import catalog: `BOOKS_DIR=… npm run books:import` against the **linked prod** project.
5. `npm run smoke:hosted` + `smoke:covers` + `smoke:pdf` with prod URL/keys.
6. Promote first real admin; disable or delete seed-style test users.
7. Point RevenueCat **production** webhook at the prod functions URL.

Do not `db reset` production. Do not copy staging entitlement rows into prod.
