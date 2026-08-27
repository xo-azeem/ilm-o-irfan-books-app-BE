-- Remove the original mock catalog (stable seed UUIDs and slugs).
-- Original books imported later use generated UUIDs / different slugs and are left intact.
-- Related collection_books / book_categories rows cascade from books.

delete from public.books
where id in (
  '33333333-3333-3333-3333-333333333001',
  '33333333-3333-3333-3333-333333333002',
  '33333333-3333-3333-3333-333333333003',
  '33333333-3333-3333-3333-333333333004',
  '33333333-3333-3333-3333-333333333005',
  '33333333-3333-3333-3333-333333333006',
  '33333333-3333-3333-3333-333333333007',
  '33333333-3333-3333-3333-333333333008',
  '33333333-3333-3333-3333-333333333009',
  '33333333-3333-3333-3333-333333333010'
)
or slug in (
  'foundations-of-tafsir',
  'revival-of-the-sciences',
  'seerah-the-prophetic-life',
  'inner-dimensions-of-prayer',
  'purification-of-the-heart',
  'usul-al-fiqh-essentials',
  'arabic-grammar-made-easy',
  'ethics-in-islam',
  'introduction-to-usul-al-fiqh',
  'seerah-early-makkah'
);

delete from public.collections
where id in (
  '44444444-4444-4444-4444-444444444001',
  '44444444-4444-4444-4444-444444444002',
  '44444444-4444-4444-4444-444444444003',
  '44444444-4444-4444-4444-444444444004',
  '44444444-4444-4444-4444-444444444005'
)
or slug in (
  'home-hero',
  'beginners-path',
  'ramadan-reading-list',
  'trending',
  'new-arrivals'
);

delete from public.authors
where (
  id in (
    '11111111-1111-1111-1111-111111111001',
    '11111111-1111-1111-1111-111111111002',
    '11111111-1111-1111-1111-111111111003',
    '11111111-1111-1111-1111-111111111004',
    '11111111-1111-1111-1111-111111111005',
    '11111111-1111-1111-1111-111111111006',
    '11111111-1111-1111-1111-111111111007',
    '11111111-1111-1111-1111-111111111008'
  )
  or slug in (
    'dr-yasir-qadhi',
    'al-ghazali',
    'sh-yasir',
    'ibn-qayyim',
    'hamza-yusuf',
    'various',
    'dr-v-abdur-rahim',
    'tariq-ramadan'
  )
)
and not exists (
  select 1 from public.books b where b.author_id = authors.id
);
