-- Singleton product flags. Admins can toggle PDF entitlement bypass without
-- redeploying Edge Function secrets. ALLOW_PDF_WITHOUT_ENTITLEMENT env still
-- works as an additional server-side override.

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  allow_pdf_without_entitlement boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

insert into public.app_settings (id, allow_pdf_without_entitlement)
values (1, false)
on conflict (id) do nothing;

update public.app_settings
set allow_pdf_without_entitlement = false
where id = 1;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_public" on public.app_settings;
create policy "app_settings_select_public"
  on public.app_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "app_settings_update_admin" on public.app_settings;
create policy "app_settings_update_admin"
  on public.app_settings for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select on table public.app_settings to anon, authenticated;
grant update on table public.app_settings to authenticated;
revoke insert, delete on table public.app_settings from anon, authenticated;
