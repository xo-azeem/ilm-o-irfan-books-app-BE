-- =============================================================================
-- Client privileges are opt-in, on every environment
-- =============================================================================
-- Found by `supabase db diff --linked` on 2026-09-13. The hosted project was
-- created when Supabase's platform default was
--
--   alter default privileges for role postgres in schema public
--     grant all on tables / sequences / functions to anon, authenticated;
--
-- so every table, view and function a migration created there came into the
-- world with full grants for both client roles. The local image the
-- migrations were written against has the newer opt-in baseline, so the same
-- migrations produce a tighter database locally than in production: on hosted,
-- anon held insert/update/delete on profiles, downloads, wishlist, highlights
-- and reading_progress, update on app_settings, select on every admin_* view,
-- and execute on every helper function. RLS was still enforced, so no row was
-- reachable that should not have been; but the hardening migrations' explicit
-- grant lists were never the whole story on the one database that matters.
--
-- Three steps, all idempotent and safe to run on either baseline:
--   1. Default privileges become opt-in for anon and authenticated, so an
--      object a future migration forgets to grant is unreachable rather than
--      wide open.
--   2. Every existing table, sequence and function loses whatever the client
--      roles inherited.
--   3. The grants the migrations actually intend are re-applied, in one place.
--      This list is what the migrations up to and including
--      20260913120000_carousel_weekly_fallback.sql produce on the opt-in
--      baseline. Later migrations keep granting explicitly, as they already do.
--
-- service_role, postgres, supabase_* and PUBLIC are untouched.
-- =============================================================================

-- 1. Nothing for new objects until a migration says so.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- 2. Strip what existing objects inherited.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Trigger helpers run as their owner, as set_updated_at already does
-- (20260814114738_harden_grants_rls_indexes.sql, section 4). These two call
-- books_search_document(), which clients are not granted, so without this an
-- admin's direct UPDATE on books or authors would fail inside the trigger the
-- moment the inherited EXECUTE goes away. Both already pin search_path.
alter function public.books_refresh_search_vector() security definer;
alter function public.authors_refresh_book_search_vectors() security definer;

-- 3. What the client roles are meant to have.
--
-- Tables and views. `authenticated` writes on the catalogue tables are the
-- admin CMS paths, gated by the *_admin_* RLS policies; a non-admin user holds
-- the privilege but no policy lets a row through.
grant select on table public.authors            to anon;
grant select on table public.books              to anon;
grant select on table public.categories         to anon;
grant select on table public.book_categories    to anon;
grant select on table public.collections        to anon;
grant select on table public.collection_books   to anon;
grant select on table public.plans              to anon;
grant select on table public.app_settings       to anon;
grant select on table public.carousel_slides    to anon;
grant select on table public.carousel_weekly    to anon;
grant select on table public.trending_weekly    to anon;
grant select on table public.book_list_items    to anon;
grant select on table public.carousel_items     to anon;
grant select on table public.category_with_counts to anon;
grant select on table public.collection_summaries to anon;

grant select, insert, update, delete on table public.authors          to authenticated;
grant select, insert, update, delete on table public.books            to authenticated;
grant select, insert, update, delete on table public.categories       to authenticated;
grant select, insert, update, delete on table public.book_categories  to authenticated;
grant select, insert, update, delete on table public.collections      to authenticated;
grant select, insert, update, delete on table public.collection_books to authenticated;
grant select, insert, update, delete on table public.plans            to authenticated;
grant select, update                 on table public.app_settings     to authenticated;
grant select on table public.carousel_slides    to authenticated;
grant select on table public.carousel_weekly    to authenticated;
grant select on table public.trending_weekly    to authenticated;
grant select on table public.book_list_items    to authenticated;
grant select on table public.carousel_items     to authenticated;
grant select on table public.category_with_counts to authenticated;
grant select on table public.collection_summaries to authenticated;

-- Per-user data. profiles has no table-level update on purpose: the editable
-- columns are granted one by one further down, so a client cannot touch role.
grant select                         on table public.profiles             to authenticated;
grant select, insert, update, delete on table public.reading_progress     to authenticated;
grant select, insert, delete         on table public.wishlist             to authenticated;
grant select, insert, update, delete on table public.downloads            to authenticated;
grant select, insert, update, delete on table public.highlights           to authenticated;
grant select                         on table public.reading_streaks      to authenticated;
grant select                         on table public.access_events        to authenticated;
grant select                         on table public.user_recommendations to authenticated;
grant select                         on table public.user_taste_state     to authenticated;

-- CMS views; each is security_invoker and the RLS underneath decides.
grant select on table public.admin_audit_log             to authenticated;
grant select on table public.admin_author_rows           to authenticated;
grant select on table public.admin_book_rows             to authenticated;
grant select on table public.admin_carousel_rows         to authenticated;
grant select on table public.admin_carousel_fallback_rows to authenticated;
grant select on table public.admin_category_rows         to authenticated;
grant select on table public.admin_collection_rows       to authenticated;
grant select on table public.admin_plan_rows             to authenticated;
grant select on table public.admin_trending_rows         to authenticated;
grant select on table public.admin_user_directory        to authenticated;

-- Column-level grants. Revoking a table privilege drops the column privileges
-- under it too, so these two sets (20260816194000_admin_roles_cms.sql and
-- 20260912120100_entitlements_column_grants.sql) are restated here verbatim.
-- profile-update writes these columns with the caller's JWT; role and
-- updated_at are deliberately absent.
grant update (
  full_name, email, phone, avatar_path, date_of_birth,
  address_line1, address_line2, city, state, postal_code, country
) on table public.profiles to authenticated;

-- entitlements: the client sees its own row (RLS) but never the store
-- identifiers or raw event payload columns.
grant select (
  user_id, plan_id, status, starts_at, expires_at, store, created_at, updated_at
) on table public.entitlements to authenticated;

-- Sequences: none. The only serial (access_events) is written by a SECURITY
-- DEFINER trigger.

-- Public RPCs and the helpers the public views call.
grant execute on function public.book_effective_pages(integer, integer) to anon, authenticated;
grant execute on function public.book_length_bucket(integer, integer)   to anon, authenticated;
grant execute on function public.length_bucket(public.books)            to anon, authenticated;
grant execute on function public.catalog_books(text, text, boolean, numeric, text[], text[], text, integer, integer)
  to anon, authenticated;
grant execute on function public.search_books(text, integer, integer)   to anon, authenticated;
grant execute on function public.collection_shelf(text, integer)        to anon, authenticated;
grant execute on function public.current_trending_week()                to anon, authenticated;
grant execute on function public.weekly_trending_books(integer)         to anon, authenticated;
grant execute on function public.weekly_trending_meta()                 to anon, authenticated;
grant execute on function public.random_published_books(integer)        to anon, authenticated;
grant execute on function public.home_carousel(integer, integer)        to anon, authenticated;

-- Signed-in RPCs.
grant execute on function public.is_admin()                                to authenticated;
grant execute on function public.current_profile_role()                    to authenticated;
grant execute on function public.my_access_state()                         to authenticated;
grant execute on function public.user_has_active_premium(uuid)             to authenticated;
grant execute on function public.upsert_reading_progress(uuid, integer, integer, numeric, text)
  to authenticated;
grant execute on function public.recommendations_for_me(integer, integer, integer) to authenticated;
grant execute on function public.storage_object_exists(text, text)         to authenticated;
grant execute on function public.storage_object_key(text, text)            to authenticated;
grant execute on function public.book_publish_blocker(uuid)                to authenticated;

-- Admin RPCs. Each re-checks is_admin() inside; the grant only lets the call
-- reach that check.
grant execute on function public.admin_analytics(integer)                  to authenticated;
grant execute on function public.admin_dashboard_stats()                   to authenticated;
grant execute on function public.admin_user_detail(uuid)                   to authenticated;
grant execute on function public.admin_storage_audit()                     to authenticated;
grant execute on function public.admin_set_user_role(uuid, text)           to authenticated;
grant execute on function public.admin_set_entitlement(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.admin_delete_books(uuid[])                to authenticated;
grant execute on function public.admin_bulk_update_books(uuid[], boolean, boolean) to authenticated;
grant execute on function public.admin_set_book_relations(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.admin_set_collection_books(uuid, uuid[])  to authenticated;
grant execute on function public.admin_reorder(text, uuid[])               to authenticated;
grant execute on function public.admin_delete_storage_object(text, text)   to authenticated;
grant execute on function public.admin_upsert_category(uuid, text, text, text, text, text, integer)
  to authenticated;
grant execute on function public.admin_delete_category(uuid, boolean)      to authenticated;
grant execute on function public.admin_upsert_collection(uuid, text, text, text, text, text, integer, boolean)
  to authenticated;
grant execute on function public.admin_delete_collection(uuid, boolean)    to authenticated;
grant execute on function public.admin_upsert_plan(uuid, text, text, integer, text, text, jsonb, text, boolean, integer)
  to authenticated;
grant execute on function public.admin_delete_plan(uuid, boolean)          to authenticated;
grant execute on function public.admin_carousel_upsert(
  uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz, timestamptz, boolean
) to authenticated;
grant execute on function public.admin_carousel_delete(uuid[])             to authenticated;
grant execute on function public.admin_carousel_reorder(uuid[])            to authenticated;
grant execute on function public.admin_carousel_set(uuid[])                to authenticated;
grant execute on function public.admin_refresh_trending_week(date, integer) to authenticated;
grant execute on function public.admin_refresh_carousel_week(date, integer) to authenticated;
