-- =============================================================================
-- RevenueCat SDK keys as app settings — set from the admin tool, no rebuild
-- =============================================================================
-- The app configures the RevenueCat SDK with a *public* key (goog_… / appl_…,
-- or a test_… Test Store key). Baking it into the build means a build made
-- before the store accounts exist can never sell; serving it from here means
-- an admin pastes the key the day RevenueCat is ready and every installed
-- build starts selling on its next launch. A key in the build still wins,
-- so a release pinned to a key is unaffected.
--
-- These are public by design — the SDK ships them in every app — which is
-- the only reason they may sit on an anon-readable row. The RevenueCat
-- *secret* key (sk_…) and REVENUECAT_WEBHOOK_AUTH must never come near this
-- table; the constraint below refuses anything that is not shaped like a
-- public key.
-- =============================================================================

alter table public.app_settings
  add column if not exists revenuecat_android_key text,
  add column if not exists revenuecat_ios_key text;

comment on column public.app_settings.revenuecat_android_key is
  'RevenueCat public SDK key for the Android app (goog_… or test_…). Served by app-status; public by design.';
comment on column public.app_settings.revenuecat_ios_key is
  'RevenueCat public SDK key for the iOS app (appl_… or test_…). Served by app-status; public by design.';

alter table public.app_settings
  drop constraint if exists app_settings_revenuecat_keys_public;

alter table public.app_settings
  add constraint app_settings_revenuecat_keys_public check (
    (revenuecat_android_key is null
      or revenuecat_android_key ~ '^(goog|test)_[A-Za-z0-9]+$')
    and (revenuecat_ios_key is null
      or revenuecat_ios_key ~ '^(appl|test)_[A-Za-z0-9]+$')
  );
