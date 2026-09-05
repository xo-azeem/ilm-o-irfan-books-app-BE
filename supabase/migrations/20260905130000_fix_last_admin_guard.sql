-- Fix: the last-admin guard never fired.
--
-- admin_set_user_role() declared its local variable as `current_role`, which is
-- a RESERVED SQL keyword. Inside the function body PostgreSQL parses it as the
-- built-in session-role value, not as the plpgsql variable, so:
--
--   select p.role into current_role   -- assigns nothing observable
--   if current_role is null           -- never true: it is 'authenticator' etc.
--   if current_role = 'admin' ...     -- never true, for the same reason
--
-- Both guards were therefore dead code. In practice that meant:
--
--   1. the last admin COULD be demoted, locking everyone out of the CMS with no
--      way back except raw SQL against the database, and
--   2. setting a role on a user id that does not exist reported success and
--      silently updated nothing.
--
-- Reproduce on any version before this migration:
--
--   do $$ declare current_role text;
--   begin select 'admin' into current_role; raise notice '%', current_role; end $$;
--   -- prints the session role, not 'admin'
--
-- The rename to v_current_role is the whole fix; the surrounding logic was
-- correct as written. `found` is used for the existence check so the function no
-- longer depends on a sentinel value at all.

create or replace function public.admin_set_user_role(target_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role text;
  v_admin_count integer;
begin
  if new_role not in ('user', 'admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  if not (select public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select p.role into v_current_role
  from public.profiles p
  where p.id = target_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  -- Demoting the last admin leaves nobody who can promote anyone, so the only
  -- route back is a hand-written UPDATE by whoever holds the database password.
  if v_current_role = 'admin' and new_role = 'user' then
    select count(*) into v_admin_count
    from public.profiles
    where role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'cannot demote the last admin' using errcode = '23514';
    end if;
  end if;

  update public.profiles
  set role = new_role
  where id = target_id;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
revoke execute on function public.admin_set_user_role(uuid, text) from anon;
grant execute on function public.admin_set_user_role(uuid, text)
  to authenticated, service_role;
