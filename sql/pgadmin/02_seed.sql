-- =============================================================================
-- Seed catalog aligned with FE mock titles (explore / library / profile)
-- Paths point at Storage object keys — upload files separately.
-- =============================================================================

-- Stable UUIDs for repeatable seeds
-- Authors
insert into public.authors (id, slug, name, bio) values
  ('11111111-1111-1111-1111-111111111001', 'dr-yasir-qadhi', 'Dr. Yasir Qadhi', 'Scholar and educator specializing in Islamic theology and history.'),
  ('11111111-1111-1111-1111-111111111002', 'al-ghazali', 'Al-Ghazali', 'Classical scholar of Islamic spirituality and philosophy.'),
  ('11111111-1111-1111-1111-111111111003', 'sh-yasir', 'Sh. Yasir', 'Teacher focusing on Seerah and prophetic biography.'),
  ('11111111-1111-1111-1111-111111111004', 'ibn-qayyim', 'Ibn Qayyim', 'Classical scholar known for works on spirituality and prayer.'),
  ('11111111-1111-1111-1111-111111111005', 'hamza-yusuf', 'Hamza Yusuf', 'Contemporary scholar and educator.'),
  ('11111111-1111-1111-1111-111111111006', 'various', 'Various', 'Compiled authors.'),
  ('11111111-1111-1111-1111-111111111007', 'dr-v-abdur-rahim', 'Dr. V. Abdur Rahim', 'Arabic language educator.'),
  ('11111111-1111-1111-1111-111111111008', 'tariq-ramadan', 'Tariq Ramadan', 'Author on Islamic ethics and contemporary thought.')
on conflict (id) do nothing;

-- Categories
insert into public.categories (id, slug, label, icon_key, accent, accent_dark, sort_order) values
  ('22222222-2222-2222-2222-222222222001', 'quranic-studies', 'Quranic Studies', 'book-marked', '#2E7D32', '#81C784', 1),
  ('22222222-2222-2222-2222-222222222002', 'spirituality', 'Spirituality', 'sparkles', '#7CB518', '#C6F542', 2),
  ('22222222-2222-2222-2222-222222222003', 'history', 'History', 'landmark', '#C9940A', '#F4C430', 3),
  ('22222222-2222-2222-2222-222222222004', 'fiqh-law', 'Fiqh & Law', 'scale', '#4A9E5C', '#72B878', 4),
  ('22222222-2222-2222-2222-222222222005', 'hadith', 'Hadith', 'scroll-text', '#9CCC65', '#D4E157', 5),
  ('22222222-2222-2222-2222-222222222006', 'arabic', 'Arabic', 'globe', '#2A9B72', '#4EC4A0', 6)
on conflict (id) do nothing;

-- Books (mirror FE catalog)
insert into public.books (
  id, slug, title, description, author_id, genre, rating, rating_count,
  price_cents, currency, format, cover_path, cover_color, cover_color_dark,
  pdf_path, file_size_bytes, read_time_minutes, tag, tags, is_premium, is_published, published_at
) values
  (
    '33333333-3333-3333-3333-333333333001',
    'foundations-of-tafsir',
    'Foundations of Tafsir',
    'A cinematic journey into the principles of Quranic interpretation — structured, clear, and deeply engaging.',
    '11111111-1111-1111-1111-111111111001',
    'Quranic Studies', 4.9, 128, 1299, 'USD', 'Digital edition',
    'covers/foundations-of-tafsir.webp', '#1B4332', '#081C15',
    'pdfs/foundations-of-tafsir.pdf', 12582912, 240, 'Editor''s pick',
    array['tafsir', 'quran'], false, true, timezone('utc', now()) - interval '30 days'
  ),
  (
    '33333333-3333-3333-3333-333333333002',
    'revival-of-the-sciences',
    'Revival of the Sciences',
    'Rediscover the spiritual sciences through one of Islam''s greatest thinkers.',
    '11111111-1111-1111-1111-111111111002',
    'Spirituality', 4.9, 256, 1499, 'USD', 'Digital edition',
    'covers/revival-of-the-sciences.webp', '#2D6A4F', '#1B4332',
    'pdfs/revival-of-the-sciences.pdf', 18874368, 360, 'Classic',
    array['spirituality', 'classic'], true, true, timezone('utc', now()) - interval '90 days'
  ),
  (
    '33333333-3333-3333-3333-333333333003',
    'seerah-the-prophetic-life',
    'Seerah: The Prophetic Life',
    'Walk through the life of the Prophet ﷺ with vivid storytelling and scholarly depth.',
    '11111111-1111-1111-1111-111111111003',
    'History', 4.7, 98, 1199, 'USD', 'Digital edition',
    'covers/seerah-the-prophetic-life.webp', '#95D5B2', '#40916C',
    'pdfs/seerah-the-prophetic-life.pdf', 15728640, 300, null,
    array['seerah', 'history'], false, true, timezone('utc', now()) - interval '20 days'
  ),
  (
    '33333333-3333-3333-3333-333333333004',
    'inner-dimensions-of-prayer',
    'Inner Dimensions of Prayer',
    'Transform your salah with profound insights into presence, humility, and devotion.',
    '11111111-1111-1111-1111-111111111004',
    'Spirituality', 4.8, 175, 1099, 'USD', 'Digital edition',
    'covers/inner-dimensions-of-prayer.webp', '#52B788', '#1B4332',
    'pdfs/inner-dimensions-of-prayer.pdf', 9437184, 180, null,
    array['prayer', 'spirituality'], false, true, timezone('utc', now()) - interval '45 days'
  ),
  (
    '33333333-3333-3333-3333-333333333005',
    'purification-of-the-heart',
    'Purification of the Heart',
    'A modern classic on cleansing the soul and nurturing sincerity in every action.',
    '11111111-1111-1111-1111-111111111005',
    'Self Development', 4.6, 210, 999, 'USD', 'Digital edition',
    'covers/purification-of-the-heart.webp', '#74C69D', '#2D6A4F',
    'pdfs/purification-of-the-heart.pdf', 11272192, 240, 'Trending',
    array['heart', 'tazkiyah'], true, true, timezone('utc', now()) - interval '15 days'
  ),
  (
    '33333333-3333-3333-3333-333333333006',
    'usul-al-fiqh-essentials',
    'Usul al-Fiqh Essentials',
    'A concise introduction to the principles of Islamic jurisprudence.',
    '11111111-1111-1111-1111-111111111006',
    'Fiqh & Law', 4.5, 64, 899, 'USD', 'Digital edition',
    'covers/usul-al-fiqh-essentials.webp', '#A3B18A', '#588157',
    'pdfs/usul-al-fiqh-essentials.pdf', 7340032, 150, 'New',
    array['fiqh', 'usul'], false, true, timezone('utc', now()) - interval '5 days'
  ),
  (
    '33333333-3333-3333-3333-333333333007',
    'arabic-grammar-made-easy',
    'Arabic Grammar Made Easy',
    'Step-by-step lessons that make classical Arabic grammar approachable.',
    '11111111-1111-1111-1111-111111111007',
    'Arabic', 4.4, 88, 799, 'USD', 'Digital edition',
    'covers/arabic-grammar-made-easy.webp', '#95D5B2', '#40916C',
    'pdfs/arabic-grammar-made-easy.pdf', 6291456, 180, 'New',
    array['arabic', 'grammar'], false, true, timezone('utc', now()) - interval '3 days'
  ),
  (
    '33333333-3333-3333-3333-333333333008',
    'ethics-in-islam',
    'Ethics in Islam',
    'Reflections on moral responsibility, compassion, and living with purpose.',
    '11111111-1111-1111-1111-111111111008',
    'Islamic Studies', 4.3, 52, 899, 'USD', 'Digital edition',
    'covers/ethics-in-islam.webp', '#1B4332', '#081C15',
    'pdfs/ethics-in-islam.pdf', 8388608, 200, null,
    array['ethics'], false, true, timezone('utc', now()) - interval '7 days'
  ),
  (
    '33333333-3333-3333-3333-333333333009',
    'introduction-to-usul-al-fiqh',
    'Introduction to Usul al-Fiqh',
    'A structured path into the sources and methods of Islamic legal theory.',
    '11111111-1111-1111-1111-111111111001',
    'Fiqh & Law', 4.7, 73, 1099, 'USD', 'Digital edition',
    'covers/introduction-to-usul-al-fiqh.webp', '#1B4332', '#081C15',
    'pdfs/introduction-to-usul-al-fiqh.pdf', 10485760, 210, null,
    array['fiqh', 'usul'], false, true, timezone('utc', now()) - interval '60 days'
  ),
  (
    '33333333-3333-3333-3333-333333333010',
    'seerah-early-makkah',
    'Seerah: Early Makkah',
    'The early Makkan period of the Prophetic life — trials, faith, and community.',
    '11111111-1111-1111-1111-111111111003',
    'History', 4.6, 61, 999, 'USD', 'Digital edition',
    'covers/seerah-early-makkah.webp', '#95D5B2', '#40916C',
    'pdfs/seerah-early-makkah.pdf', 9437184, 180, null,
    array['seerah'], false, true, timezone('utc', now()) - interval '40 days'
  )
on conflict (id) do nothing;

-- Book ↔ category
insert into public.book_categories (book_id, category_id) values
  ('33333333-3333-3333-3333-333333333001', '22222222-2222-2222-2222-222222222001'),
  ('33333333-3333-3333-3333-333333333002', '22222222-2222-2222-2222-222222222002'),
  ('33333333-3333-3333-3333-333333333003', '22222222-2222-2222-2222-222222222003'),
  ('33333333-3333-3333-3333-333333333004', '22222222-2222-2222-2222-222222222002'),
  ('33333333-3333-3333-3333-333333333005', '22222222-2222-2222-2222-222222222002'),
  ('33333333-3333-3333-3333-333333333006', '22222222-2222-2222-2222-222222222004'),
  ('33333333-3333-3333-3333-333333333007', '22222222-2222-2222-2222-222222222006'),
  ('33333333-3333-3333-3333-333333333008', '22222222-2222-2222-2222-222222222002'),
  ('33333333-3333-3333-3333-333333333009', '22222222-2222-2222-2222-222222222004'),
  ('33333333-3333-3333-3333-333333333010', '22222222-2222-2222-2222-222222222003')
on conflict do nothing;

-- Collections
insert into public.collections (id, slug, title, subtitle, accent, kind, sort_order, is_published) values
  (
    '44444444-4444-4444-4444-444444444001',
    'home-hero',
    'Featured',
    'Hero carousel for Home',
    '#2E7D32',
    'hero',
    0,
    true
  ),
  (
    '44444444-4444-4444-4444-444444444002',
    'beginners-path',
    'Beginner''s Path',
    '12 essential reads to start your journey',
    '#2E7D32',
    'shelf',
    1,
    true
  ),
  (
    '44444444-4444-4444-4444-444444444003',
    'ramadan-reading-list',
    'Ramadan Reading List',
    'Reflections for the blessed month',
    '#F4C430',
    'shelf',
    2,
    true
  ),
  (
    '44444444-4444-4444-4444-444444444004',
    'trending',
    'Trending',
    'Popular right now',
    '#7CB518',
    'carousel',
    3,
    true
  ),
  (
    '44444444-4444-4444-4444-444444444005',
    'new-arrivals',
    'New Arrivals',
    'Fresh additions to the library',
    '#4A9E5C',
    'carousel',
    4,
    true
  )
on conflict (id) do nothing;

insert into public.collection_books (collection_id, book_id, sort_order) values
  -- Hero
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333001', 1),
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333002', 2),
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333003', 3),
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333004', 4),
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333005', 5),
  -- Beginner
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333001', 1),
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333006', 2),
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333007', 3),
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333004', 4),
  -- Ramadan
  ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333005', 1),
  ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333002', 2),
  ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333004', 3),
  -- Trending
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333004', 1),
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333002', 2),
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333003', 3),
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333005', 4),
  -- New arrivals
  ('44444444-4444-4444-4444-444444444005', '33333333-3333-3333-3333-333333333006', 1),
  ('44444444-4444-4444-4444-444444444005', '33333333-3333-3333-3333-333333333007', 2),
  ('44444444-4444-4444-4444-444444444005', '33333333-3333-3333-3333-333333333008', 3)
on conflict do nothing;

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
