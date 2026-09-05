# Runbooks

Short, specific procedures for the failures this backend can actually have. Each one is
written to be followed at 2am by someone who did not build the thing.

| Runbook | Symptom that sends you here |
| --- | --- |
| [paywall-open.md](./paywall-open.md) | Premium books opening for users who never paid |
| [webhook-down.md](./webhook-down.md) | Purchases not turning into entitlements |
| [storage-miss.md](./storage-miss.md) | `PDF_NOT_IN_STORAGE`, blank covers, broken downloads |
| [auth-failures.md](./auth-failures.md) | Sign-in, Google redirect, or admin-role problems |
| [secret-rotation.md](./secret-rotation.md) | A key leaked, or scheduled rotation |

## Before you start

Everything below assumes:

- Supabase Dashboard access for the affected project
- `supabase` CLI logged in and linked (`npm run link`)
- The function logs: Dashboard → Edge Functions → *function* → Logs

## The two commands worth remembering

```bash
npx supabase functions logs <function-name> --project-ref <ref>   # what actually happened
npx supabase secrets list --project-ref <ref>                     # what the functions were configured with
```

Log lines from these functions are prefixed with the function name in brackets
(`[get-signed-pdf] ...`). Raw Postgres text is logged there and never returned to the app,
so the log is the only place a driver-level message appears.
