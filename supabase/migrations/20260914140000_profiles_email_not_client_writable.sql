-- profiles.email is written by handle_new_user() from auth.users and read back
-- by profile-read; it was never meant to be client-writable, and profile-update
-- does not write it. 20260816194000_admin_roles_cms.sql (restated by
-- 20260913130000_opt_in_privileges.sql) granted column UPDATE on it beside the
-- contact fields anyway, so a direct PostgREST PATCH could set profiles.email
-- to anything without touching the auth email. Nothing in the app or the CMS
-- relies on that grant.

revoke update (email) on table public.profiles from authenticated;
