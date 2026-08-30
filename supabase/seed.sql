-- =============================================================================
-- Baseline taxonomy and subscription plan.
-- Catalog titles are imported separately (original books), not mocked here.
-- =============================================================================

-- Categories
insert into public.categories (id, slug, label, icon_key, accent, accent_dark, sort_order) values
  ('22222222-2222-2222-2222-222222222001', 'quranic-studies', 'Quranic Studies', 'book-marked', '#2E7D32', '#81C784', 1),
  ('22222222-2222-2222-2222-222222222002', 'spirituality', 'Spirituality', 'sparkles', '#7CB518', '#C6F542', 2),
  ('22222222-2222-2222-2222-222222222003', 'history', 'History', 'landmark', '#C9940A', '#F4C430', 3),
  ('22222222-2222-2222-2222-222222222004', 'fiqh-law', 'Fiqh & Law', 'scale', '#4A9E5C', '#72B878', 4),
  ('22222222-2222-2222-2222-222222222005', 'hadith', 'Hadith', 'scroll-text', '#9CCC65', '#D4E157', 5),
  ('22222222-2222-2222-2222-222222222006', 'arabic', 'Arabic', 'globe', '#2A9B72', '#4EC4A0', 6)
on conflict (id) do nothing;

-- Premium plan (matches FE subscription copy)
insert into public.plans (
  id, code, name, price_cents, currency, interval, features, revenuecat_product_id, is_active, sort_order
) values (
  '55555555-5555-5555-5555-555555555001',
  'premium_monthly',
  'Premium',
  149900,
  'PKR',
  'month',
  '[
    "Unlimited access to all books",
    "Offline downloads",
    "Audio lessons & highlights",
    "Early access to new releases"
  ]'::jsonb,
  'premium_monthly',
  true,
  1
)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Local development accounts
-- -----------------------------------------------------------------------------
-- seed.sql only ever runs against the LOCAL stack (`supabase start` /
-- `db reset`); `supabase db push` does not execute it, so these accounts can
-- never reach the hosted project.
--
-- They exist so a `db reset` does not leave you with an empty auth table and no
-- way to sign in. Both use the password: Password123!
--
--   admin@gmail.com  role=admin  -> reads any PDF via the role bypass in
--                                   get-signed-pdf, no subscription needed
--   test@gmail.com   role=user   -> comped entitlement below, so the paywall
--                                   lets it through
--
-- This mirrors the two accounts on the hosted project.

do $$
declare
  v_user record;
begin
  for v_user in
    select * from (values
      ('admin@gmail.com', 'admin'),
      ('test@gmail.com',  'user')
    ) as t(email, role)
  loop
    if not exists (select 1 from auth.users u where u.email = v_user.email) then
      -- The *_token columns must be '' rather than NULL: GoTrue scans them
      -- into Go strings and a NULL fails the whole lookup with
      -- "converting NULL to string is unsupported", which surfaces as a 500
      -- "Database error querying schema" on every sign-in attempt.
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token,
        reauthentication_token
      )
      values (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        v_user.email,
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        timezone('utc', now()),
        timezone('utc', now()),
        timezone('utc', now()),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        '{}'::jsonb,
        '', '', '', '', '', '', '', ''
      );

      -- GoTrue requires a matching identity row for password sign-in.
      -- auth.identities.email is GENERATED from identity_data->>'email', so it
      -- must not appear in the column list.
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      )
      select
        u.id::text, u.id,
        jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
        'email',
        timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
      from auth.users u
      where u.email = v_user.email;
    end if;

    -- on_auth_user_created creates the profile; set the role afterwards.
    update public.profiles set role = v_user.role where email = v_user.email;
  end loop;
end;
$$;

-- Comped subscription for the QA account. expires_at = NULL is the schema's
-- "never expires", so it cannot lapse partway through a testing session.
insert into public.entitlements (user_id, plan_id, status, store, starts_at, expires_at)
select p.id, '55555555-5555-5555-5555-555555555001', 'active', 'promotional',
       timezone('utc', now()), null
from public.profiles p
where p.email = 'test@gmail.com'
on conflict (user_id) do update
set plan_id    = excluded.plan_id,
    status     = 'active',
    store      = 'promotional',
    expires_at = null;
