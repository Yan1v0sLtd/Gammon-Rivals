-- Grant Back Office permissions by verified Supabase Auth email.
--
-- This lets the first owner sign in with Google and receive admin access
-- without needing a pre-existing profile_id row in admin_roles.

create schema if not exists private;

create table if not exists public.admin_email_allowlist (
  email text primary key
    check (
      email = lower(trim(email))
      and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ),
  role text not null check (role in ('owner', 'admin', 'support', 'viewer')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists admin_email_allowlist_updated_at on public.admin_email_allowlist;
create trigger admin_email_allowlist_updated_at
  before update on public.admin_email_allowlist
  for each row execute function public.set_updated_at();

alter table public.admin_email_allowlist enable row level security;

grant select, insert, update, delete on public.admin_email_allowlist to authenticated;

insert into public.admin_email_allowlist (email, role, note)
values ('contact@yanivos.com', 'owner', 'Initial owner email')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

create or replace function private.current_admin_role()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with candidates as (
    select role
    from public.admin_roles
    where profile_id = auth.uid()

    union all

    select role
    from public.admin_email_allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  select role
  from candidates
  order by case role
    when 'owner' then 1
    when 'admin' then 2
    when 'support' then 3
    when 'viewer' then 4
    else 5
  end
  limit 1;
$$;

create or replace function private.is_admin(check_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select private.current_admin_role() in ('owner', 'admin', 'support', 'viewer');
$$;

create or replace function private.can_manage_config(check_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select private.current_admin_role() in ('owner', 'admin');
$$;

create or replace function public.get_my_admin_role()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select private.current_admin_role();
$$;

revoke all on function private.current_admin_role() from public;
revoke all on function public.get_my_admin_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_admin_role() to authenticated;
grant execute on function public.get_my_admin_role() to authenticated;
grant execute on function private.is_admin(uuid) to anon, authenticated;
grant execute on function private.can_manage_config(uuid) to anon, authenticated;

drop policy if exists "admin_email_allowlist_select_self_or_admin" on public.admin_email_allowlist;
create policy "admin_email_allowlist_select_self_or_admin"
  on public.admin_email_allowlist for select
  using (
    email = lower(coalesce(auth.jwt() ->> 'email', ''))
    or private.is_admin(auth.uid())
  );

drop policy if exists "admin_email_allowlist_insert_admin" on public.admin_email_allowlist;
create policy "admin_email_allowlist_insert_admin"
  on public.admin_email_allowlist for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "admin_email_allowlist_update_admin" on public.admin_email_allowlist;
create policy "admin_email_allowlist_update_admin"
  on public.admin_email_allowlist for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "admin_email_allowlist_delete_admin" on public.admin_email_allowlist;
create policy "admin_email_allowlist_delete_admin"
  on public.admin_email_allowlist for delete
  using (private.can_manage_config(auth.uid()));

drop trigger if exists admin_email_allowlist_audit_log on public.admin_email_allowlist;
create trigger admin_email_allowlist_audit_log
  after insert or update or delete on public.admin_email_allowlist
  for each row execute function private.log_admin_config_change();
