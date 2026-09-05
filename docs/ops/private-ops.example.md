# Private ops note (copy locally — do not commit filled values)

Copy to something gitignored (e.g. `docs/ops/private-ops.local.md` or a password manager).

| Item | Staging | Production |
| --- | --- | --- |
| Project ref | | |
| Dashboard URL | `https://supabase.com/dashboard/project/<ref>` | |
| API URL | `https://<ref>.supabase.co` | |
| Anon key location | Dashboard → Settings → API / password manager | |
| Service role location | password manager only | |
| DB password location | password manager | |
| Access token (`sbp_…`) location | Account → Access Tokens / CI secret | |
| RevenueCat webhook URL | `https://<ref>.supabase.co/functions/v1/revenuecat-webhook` | |
| `REVENUECAT_WEBHOOK_AUTH` location | Edge secrets + RC dashboard | |
| First admin email | | |
| Google OAuth client ids | | |
| Last secret rotation | | |

## Staging checklist leftovers

- [ ] Authentication → Email enabled; confirmations On
- [ ] First admin signed up + `UPDATE profiles SET role = 'admin' …` + re-login
- [ ] Replace staging RC placeholder with a real shared secret when RC is ready
- [ ] `BOOKS_DIR=… npm run books:import` + `admin-storage-audit`
- [ ] `npm run smoke:rls` (optional user/admin JWTs)

Never commit this file with real secrets. `.env` is already gitignored.
