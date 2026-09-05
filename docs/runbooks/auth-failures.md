# Runbook: auth, redirects, and admin role

**Severity:** high if signup is broken, medium for a single account.

## Symptom → first place to look

| Symptom | Start at |
| --- | --- |
| Every authenticated endpoint returns `401 AUTH_REQUIRED` | [Token](#every-request-is-401) |
| Google sign-in returns to a browser error page | [Redirects](#google-sign-in-fails-or-lands-on-a-blank-page) |
| Sign-up succeeds but the app has no profile | [Profile bootstrap](#a-user-exists-in-auth-but-has-no-profile) |
| A promoted admin still gets `403 FORBIDDEN` | [Admin role](#a-promoted-admin-is-still-forbidden) |

## Every request is 401

`AUTH_REQUIRED` means the `Authorization` header was missing, malformed, or the token did
not verify. In order:

1. Is the app sending `Authorization: Bearer <access_token>` — the user's token, not the
   anon key? The anon key belongs in `apikey`.
2. Has the token expired? `jwt_expiry` is 3600s. The client SDK refreshes automatically
   only if the session was persisted; a missing storage adapter looks exactly like this.
3. Are you calling the right project? A token from the local stack does not verify against
   a hosted project, and the error is identical.

```bash
npx supabase functions logs profile-read --project-ref <ref>
```

If the log has no entry at all, the gateway rejected the call before the function ran —
that is `verify_jwt = true` doing its job on a request with no valid token.

## Google sign-in fails or lands on a blank page

Google OAuth needs three lists to agree:

| Where | What must be there |
| --- | --- |
| Google Cloud → Credentials → OAuth client | `https://<ref>.supabase.co/auth/v1/callback` as an authorised redirect URI |
| Supabase Dashboard → Authentication → Providers → Google | Client ID and secret, provider enabled |
| Supabase Dashboard → Authentication → URL Configuration | The app's deep link in **Redirect URLs** |

`supabase/config.toml` ships with `[auth.external.google] enabled = false` and
`site_url = "http://127.0.0.1:3000"`. Those are the **local** values; the hosted project is
configured in the Dashboard and is not read from that file. Do not "fix" a hosted redirect
by editing config.toml.

The mobile deep link (e.g. `ilmoirfan://auth-callback`) must be listed in Redirect URLs
verbatim, including scheme. A missing entry produces a redirect the browser cannot follow
and no error in the function logs, because no function was involved.

## A user exists in Auth but has no profile

`public.handle_new_user()` fires on insert into `auth.users` and creates the `profiles` row
plus the `reading_streaks` row. If a profile is missing:

```sql
select u.id, u.email, p.id as profile_id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
```

Repair by re-running the same upsert the trigger does:

```sql
insert into public.profiles (id, email, full_name, phone)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  u.raw_user_meta_data ->> 'phone'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
```

Then confirm the trigger still exists — if profiles stopped being created for *everyone*,
the trigger was dropped, not the rows:

```sql
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
```

Signup metadata contract: the app sends `full_name` and `phone` in the signup metadata.
`email` is owned by Auth and is not writable through `profile-update`.

## A promoted admin is still forbidden

`is_admin()` accepts either the JWT claim `app_metadata.app_role = 'admin'` **or**
`profiles.role = 'admin'`, so a fresh promotion works immediately without re-login.

If it does not:

```sql
select id, email, role from public.profiles where email = '<email>';
```

- `role` is not `admin` → the promotion did not land. Use
  `POST /functions/v1/admin-set-user-role { "userId": "...", "role": "admin" }`.
- `role` is `admin` but the app still gets 403 → the app is calling with a cached token
  from before the profile existed, or it is calling the wrong project.

**Demotion is the direction that needs a re-login.** A token issued while the user was an
admin keeps `app_role: admin` until it expires. Force sign-out for a demotion that matters.

The last admin cannot be demoted — `admin_set_user_role` refuses, deliberately. If you have
locked yourself out entirely, promote from SQL in the Dashboard:

```sql
update public.profiles set role = 'admin' where email = '<your-email>';
```
