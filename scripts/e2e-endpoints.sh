#!/usr/bin/env bash
# End-to-end regression suite for the Ilm o Irfan Edge Functions.
# Assumes: npx supabase start + db reset already run, functions serve running.
set -u

B=http://127.0.0.1:54321/functions/v1
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
DB=supabase_db_ilm-o-irfan
BOOK=aaaaaaaa-0000-0000-0000-000000000001
DRAFT=aaaaaaaa-0000-0000-0000-000000000003

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }
is(){ [ "$2" = "$3" ] && ok "$1" || no "$1" "$3" "$2"; }
has(){ case "$2" in *"$3"*) ok "$1";; *) no "$1" "contains '$3'" "${2:0:150}";; esac; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }

psqlq(){ docker exec -i "$DB" psql -U postgres -d postgres -q -t -A -c "$1"; }

echo "== seeding =="
docker exec -i "$DB" psql -U postgres -d postgres -q >/dev/null <<'SQL'
-- Clear any previous fixtures first. `on conflict (slug) do nothing` is not
-- enough on its own: a leftover row holding one of these ids under a different
-- slug raises a primary key violation that aborts the whole INSERT, leaving the
-- suite to run against an empty catalog and fail for the wrong reason.
delete from public.books
 where id in ('aaaaaaaa-0000-0000-0000-000000000001',
              'aaaaaaaa-0000-0000-0000-000000000002',
              'aaaaaaaa-0000-0000-0000-000000000003')
    or slug in ('ihya','masnavi','draft');
delete from public.authors
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222')
    or slug in ('imam-ghazali','rumi');

insert into public.authors (id, slug, name) values
  ('11111111-1111-1111-1111-111111111111','imam-ghazali','Imam Al Ghazali'),
  ('22222222-2222-2222-2222-222222222222','rumi','Jalaluddin Rumi') on conflict (slug) do nothing;
insert into public.books (id, slug, title, description, author_id, genre, tag, tags, pdf_path, is_published, published_at, is_premium) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ihya','Ihya Ulum al-Din','A revival of the religious sciences.','11111111-1111-1111-1111-111111111111','Spirituality','Classic', array['fiqh','ethics'], 'pdfs/ihya.pdf', true, now(), true),
  ('aaaaaaaa-0000-0000-0000-000000000002','masnavi','The Masnavi','Poetry of the soul and divine love.','22222222-2222-2222-2222-222222222222','Poetry','Featured', array['sufism'], 'pdfs/masnavi.pdf', true, now(), false),
  ('aaaaaaaa-0000-0000-0000-000000000003','draft','Unpublished Draft','Hidden work in progress.','22222222-2222-2222-2222-222222222222','Poetry',null, array[]::text[], null, false, null, false) on conflict (slug) do nothing;
SQL
printf '%%PDF-1.4\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > /tmp/e2e.pdf
curl -s -X POST "http://127.0.0.1:54321/storage/v1/object/pdfs/ihya.pdf" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/pdf" --data-binary @/tmp/e2e.pdf >/dev/null

EMAIL="e2e$(date +%s)@test.local"
TOKEN=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Password123!\"}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "could not create user"; exit 1; }
A=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
P=(-H "Authorization: Bearer $ANON")

echo
echo "== public catalog =="
is "home-feed 200"        "$(code "$B/home-feed" "${P[@]}")" 200
is "books-list 200"       "$(code "$B/books-list" "${P[@]}")" 200
is "book-detail 200"      "$(code "$B/book-detail?id=$BOOK" "${P[@]}")" 200
is "categories-list 200"  "$(code "$B/categories-list" "${P[@]}")" 200
is "collections-list 200" "$(code "$B/collections-list" "${P[@]}")" 200
is "plans-list 200"       "$(code "$B/plans-list" "${P[@]}")" 200
is "book-detail bad uuid 400" "$(code "$B/book-detail?id=nope" "${P[@]}")" 400
is "book-detail draft 404"    "$(code "$B/book-detail?id=$DRAFT" "${P[@]}")" 404
has "books-list has no tsvector" "$(curl -s "$B/books-list" "${P[@]}")" '"published_at"'
case "$(curl -s "$B/books-list" "${P[@]}")" in *search_vector*) no "tsvector not leaked" "absent" "present";; *) ok "tsvector not leaked";; esac

echo
echo "== search =="
has "by author"      "$(curl -s "$B/books-search?q=Ghazali" "${P[@]}")" 'Ihya'
has "by title"       "$(curl -s "$B/books-search?q=Masnavi" "${P[@]}")" 'Masnavi'
has "by description" "$(curl -s "$B/books-search?q=divine%20love" "${P[@]}")" 'Masnavi'
has "by tag"         "$(curl -s "$B/books-search?q=sufism" "${P[@]}")" 'Masnavi'
has "draft hidden"   "$(curl -s "$B/books-search?q=Hidden" "${P[@]}")" '"totalCount":0'
is  "punctuation 200" "$(code "$B/books-search?q=a%2Cb%28c%29%26--%3B" "${P[@]}")" 200
has "empty query"    "$(curl -s "$B/books-search?q=" "${P[@]}")" '"totalCount":0'

echo
echo "== pagination =="
has "page1 hasNext"  "$(curl -s "$B/books-list?page=1&pageSize=1" "${P[@]}")" '"hasNextPage":true'
has "page2 hasPrev"  "$(curl -s "$B/books-list?page=2&pageSize=1" "${P[@]}")" '"hasPreviousPage":true'
has "pageSize clamp" "$(curl -s "$B/books-list?pageSize=9999" "${P[@]}")" '"pageSize":100'
has "garbage page"   "$(curl -s "$B/books-list?page=abc" "${P[@]}")" '"page":1'

echo
echo "== auth gate (no token) =="
for e in profile-read reading-progress wishlist-list downloads-list highlights-list library-overview entitlements-status admin-books get-signed-pdf; do
  is "$e 401" "$(code -X POST "$B/$e" -H 'Content-Type: application/json' -d '{}')" 401
done

echo
echo "== profile partial update (data-loss regression) =="
curl -s -X PUT "$B/profile-update" "${A[@]}" -d '{"full_name":"Full Name","phone":"+92 300 1234567","city":"Lahore","country":"Pakistan","address_line1":"12 Mall Road"}' >/dev/null
R=$(curl -s -X PUT "$B/profile-update" "${A[@]}" -d '{"full_name":"Only Name Changed"}')
has "name updated"    "$R" '"full_name":"Only Name Changed"'
has "phone survived"  "$R" '"phone":"+92 300 1234567"'
has "city survived"   "$R" '"city":"Lahore"'
has "address survived" "$R" '"address_line1":"12 Mall Road"'
is  "empty body 400"  "$(code -X PUT "$B/profile-update" "${A[@]}" -d '{}')" 400
has "explicit null clears" "$(curl -s -X PUT "$B/profile-update" "${A[@]}" -d '{"city":null}')" '"city":null'

echo
echo "== reading progress scale =="
has "progress 1 = finished" "$(curl -s -X POST "$B/reading-progress" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"progress\":1}")" '"progress":1'
has "percent 1 = 1%"        "$(curl -s -X POST "$B/reading-progress" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"progress_percent\":1}")" '"progress":0.01'
is  "out of range 400"      "$(code -X POST "$B/reading-progress" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"progress\":55}")" 400
is  "both scales 400"       "$(code -X POST "$B/reading-progress" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"progress\":0.5,\"progress_percent\":50}")" 400
is  "bad uuid 400"          "$(code -X POST "$B/reading-progress" "${A[@]}" -d '{"book_id":"nope"}')" 400
is  "missing book 404"      "$(code -X POST "$B/reading-progress" "${A[@]}" -d '{"book_id":"99999999-9999-9999-9999-999999999999"}')" 404

echo
echo "== wishlist =="
curl -s -X POST "$B/wishlist-toggle" "${A[@]}" -d "{\"book_id\":\"$BOOK\"}" >/dev/null
has "toggle removes" "$(curl -s -X POST "$B/wishlist-toggle" "${A[@]}" -d "{\"book_id\":\"$BOOK\"}")" '"wishlisted":false'
RACE=""
for i in 1 2 3 4 5 6 7 8; do RACE="$RACE$(code -X POST "$B/wishlist-toggle" "${A[@]}" -d "{\"book_id\":\"$BOOK\"}" &)"; done; wait
case "$RACE" in *500*) no "8 concurrent toggles no 500" "no 500s" "$RACE";; *) ok "8 concurrent toggles no 500";; esac
is "missing book 404" "$(code -X POST "$B/wishlist-toggle" "${A[@]}" -d '{"book_id":"99999999-9999-9999-9999-999999999999"}')" 404

echo
echo "== downloads / highlights =="
is "downloads-create 200" "$(code -X POST "$B/downloads-create" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"file_size_bytes\":999}")" 200
is "bad status 400"       "$(code -X POST "$B/downloads-create" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"status\":\"bogus\"}")" 400
HID=$(curl -s -X POST "$B/highlights-upsert" "${A[@]}" -d "{\"book_id\":\"$BOOK\",\"page_number\":12,\"text_excerpt\":\"excerpt text\",\"color\":\"amber\"}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
R=$(curl -s -X POST "$B/highlights-upsert" "${A[@]}" -d "{\"id\":\"$HID\",\"note\":\"my note\"}")
has "note updated"     "$R" '"note":"my note"'
has "excerpt survived" "$R" '"text_excerpt":"excerpt text"'
has "color survived"   "$R" '"color":"amber"'

echo
echo "== paywall =="
psqlq "delete from public.entitlements where user_id=(select id from public.profiles where email='$EMAIL');" >/dev/null
has "no entitlement -> PREMIUM_REQUIRED" "$(curl -s -X POST "$B/get-signed-pdf" "${A[@]}" -d "{\"bookId\":\"$BOOK\"}")" 'PREMIUM_REQUIRED'
psqlq "insert into public.entitlements (user_id,status,store,starts_at,expires_at) select id,'active','stripe',now(),now()+interval '30 days' from public.profiles where email='$EMAIL' on conflict (user_id) do update set status='active',expires_at=now()+interval '30 days';" >/dev/null
R=$(curl -s -X POST "$B/get-signed-pdf" "${A[@]}" -d "{\"bookId\":\"$BOOK\"}")
has "with entitlement -> signedUrl" "$R" 'signedUrl'
URL=$(echo "$R" | sed -n 's/.*"signedUrl":"\([^"]*\)".*/\1/p' | sed 's|http://kong:8000|http://127.0.0.1:54321|')
is "signed url serves pdf 200" "$(code "$URL")" 200
is "unsigned object denied"    "$(code 'http://127.0.0.1:54321/storage/v1/object/pdfs/ihya.pdf')" 400
is "deprecated alias 410"      "$(code -X POST "$B/signed-pdf" -H 'Content-Type: application/json' -d '{}')" 410

echo
echo "== admin gate =="
for e in admin-books admin-users admin-analytics admin-settings; do
  is "$e forbidden for user" "$(code "$B/$e" "${A[@]}")" 403
done
psqlq "update public.profiles set role='admin' where email='$EMAIL';" >/dev/null
for e in admin-books admin-users admin-categories admin-collections admin-settings; do
  is "$e 200 for admin" "$(code "$B/$e" "${A[@]}")" 200
done
is "admin-analytics 200" "$(code "$B/admin-analytics?days=30" "${A[@]}")" 200
has "analytics payload"  "$(curl -s "$B/admin-analytics?days=30" "${A[@]}")" 'top_books'

echo
echo "== admin settings partial patch =="
curl -s -X PATCH "$B/admin-settings" "${A[@]}" -d '{"maintenance_message":"msg","signup_enabled":true}' >/dev/null
R=$(curl -s -X PATCH "$B/admin-settings" "${A[@]}" -d '{"maintenance_mode":true}')
has "boolean set"       "$R" '"maintenance_mode":true'
has "message survived"  "$R" '"maintenance_message":"msg"'
has "signup survived"   "$R" '"signup_enabled":true'
is  "bad type 400"      "$(code -X PATCH "$B/admin-settings" "${A[@]}" -d '{"signup_enabled":"maybe"}')" 400
is  "empty patch 400"   "$(code -X PATCH "$B/admin-settings" "${A[@]}" -d '{}')" 400

echo
echo "== admin book update =="
has "partial edit"  "$(curl -s -X PATCH "$B/admin-book-update" "${A[@]}" -d "{\"id\":\"$DRAFT\",\"genre\":\"Classical\"}")" '"description":"Hidden work in progress."'
is  "bad price 400" "$(code -X PATCH "$B/admin-book-update" "${A[@]}" -d "{\"id\":\"$DRAFT\",\"price_cents\":-5}")" 400
is  "unknown 404"   "$(code -X PATCH "$B/admin-book-update" "${A[@]}" -d '{"id":"99999999-9999-9999-9999-999999999999","genre":"x"}')" 404
is  "no fields 400" "$(code -X PATCH "$B/admin-book-update" "${A[@]}" -d "{\"id\":\"$DRAFT\"}")" 400

echo
echo "== method guards =="
is "GET profile-update 405"   "$(code "$B/profile-update" "${A[@]}")" 405
is "DELETE reading-prog 405"  "$(code -X DELETE "$B/reading-progress" "${A[@]}")" 405
is "GET wishlist-toggle 405"  "$(code "$B/wishlist-toggle" "${A[@]}")" 405
is "OPTIONS preflight 200"    "$(code -X OPTIONS "$B/books-list")" 200

echo
echo "=============================="
printf "  passed: %s   failed: %s\n" "$PASS" "$FAIL"
echo "=============================="
[ "$FAIL" -eq 0 ]
