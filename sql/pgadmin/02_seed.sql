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

-- Home / catalog shelves (import + home-feed depend on these slugs)
insert into public.collections (id, slug, title, subtitle, accent, kind, sort_order, is_published) values
  ('44444444-4444-4444-4444-444444444001', 'home-hero', 'Featured', 'Start here', '#2E7D32', 'hero', 1, true),
  ('44444444-4444-4444-4444-444444444002', 'trending', 'Trending now', 'Popular with readers', '#C9940A', 'shelf', 2, true),
  ('44444444-4444-4444-4444-444444444003', 'new-arrivals', 'New arrivals', 'Recently added', '#4A9E5C', 'shelf', 3, true),
  ('44444444-4444-4444-4444-444444444004', 'beginners-path', 'Beginner''s Path', 'Gentle introductions', '#7CB518', 'shelf', 4, true),
  ('44444444-4444-4444-4444-444444444005', 'ramadan-reading', 'Ramadan Reading List', 'Seasonal picks', '#2A9B72', 'carousel', 5, true)
on conflict (id) do nothing;

update public.app_settings
set featured_collection_id = '44444444-4444-4444-4444-444444444001'
where id = 1
  and featured_collection_id is null;

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
