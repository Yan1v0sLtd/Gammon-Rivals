-- Podium images — a BO-managed library for the lobby carousel "podium"
-- (the stand the board sits on). Was a single hardcoded asset
-- (/lobby/holders/royal-holder.webp). Now the operator can upload more
-- and switch which one is shown for a fresh look, all from the Back
-- Office under the boards section.
--
-- Model: a small library table. Many rows can exist; exactly ONE is
-- active at a time (enforced by a partial unique index + the
-- set_active_podium RPC). The lobby reads the active row's URL.

/* -------------------------------------------------------------------------- */
/* Library table                                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.podium_images (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Podium' check (length(trim(name)) > 0),
  image_url text not null check (length(trim(image_url)) > 0),
  is_active boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.podium_images is
  'BO-managed library of carousel podium images (the stand the board sits on). Exactly one row is_active at a time; the lobby renders that one. Use set_active_podium() to switch.';

-- At most one active podium. Partial unique index → an INSERT/UPDATE that
-- would create a second active row fails, which is why activation must go
-- through set_active_podium (it clears the others first).
drop index if exists podium_images_one_active;
create unique index podium_images_one_active
  on public.podium_images (is_active)
  where is_active;

drop trigger if exists podium_images_updated_at on public.podium_images;
create trigger podium_images_updated_at
  before update on public.podium_images
  for each row execute function public.set_updated_at();

drop trigger if exists podium_images_audit_log on public.podium_images;
create trigger podium_images_audit_log
  after insert or update or delete on public.podium_images
  for each row execute function private.log_admin_config_change();

/* -------------------------------------------------------------------------- */
/* RLS — read for everyone (the lobby needs the active URL), writes admin-only */
/* -------------------------------------------------------------------------- */

alter table public.podium_images enable row level security;

grant select on public.podium_images to anon, authenticated;
grant insert, update, delete on public.podium_images to authenticated;

drop policy if exists "podium_images_read_all" on public.podium_images;
create policy "podium_images_read_all"
  on public.podium_images for select
  to anon, authenticated
  using (true);

drop policy if exists "podium_images_insert_admin" on public.podium_images;
create policy "podium_images_insert_admin"
  on public.podium_images for insert
  to authenticated
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "podium_images_update_admin" on public.podium_images;
create policy "podium_images_update_admin"
  on public.podium_images for update
  to authenticated
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "podium_images_delete_admin" on public.podium_images;
create policy "podium_images_delete_admin"
  on public.podium_images for delete
  to authenticated
  using (private.can_manage_config(auth.uid()));

/* -------------------------------------------------------------------------- */
/* set_active_podium — flip which podium is live, atomically                   */
/* -------------------------------------------------------------------------- */

-- Two statements so the partial unique index never sees two active rows:
-- clear the others first, then activate the target. Admin-gated.
create or replace function public.set_active_podium(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized';
  end if;

  update public.podium_images
    set is_active = false, updated_by = auth.uid()
    where is_active and id <> p_id;

  update public.podium_images
    set is_active = true, updated_by = auth.uid()
    where id = p_id;

  if not found then
    raise exception 'podium % not found', p_id;
  end if;
end;
$$;

grant execute on function public.set_active_podium(uuid) to authenticated;

/* -------------------------------------------------------------------------- */
/* Seed — the current hardcoded podium, set active so nothing changes visually */
/* until the operator uploads + activates a new one.                          */
/* -------------------------------------------------------------------------- */

insert into public.podium_images (name, image_url, is_active, sort_order)
select 'Royal Holder', '/lobby/holders/royal-holder.webp', true, 10
where not exists (select 1 from public.podium_images);
