-- Loading screen images — a BO-managed library for the app's full-screen
-- loading cover (Suspense fallback + route-transition overlay). Was a
-- hardcoded spinner screen; now the operator can upload themed art (holiday
-- events, promos) and switch which one is shown, from the Back Office.
--
-- Model: identical to podium_images — a small library table. Many rows can
-- exist; exactly ONE is active at a time (partial unique index + the
-- set_active_loading_screen RPC). The client reads the active row's URL and
-- caches it in localStorage so the very first paint (before any network)
-- still shows the last-known art; a bundled default ships in /public.

/* -------------------------------------------------------------------------- */
/* Library table                                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.loading_screen_images (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Loading screen' check (length(trim(name)) > 0),
  image_url text not null check (length(trim(image_url)) > 0),
  is_active boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.loading_screen_images is
  'BO-managed library of full-screen loading-screen art. Exactly one row is_active at a time; the client renders that one (cached in localStorage for cold starts). Use set_active_loading_screen() to switch.';

-- At most one active loading screen. Partial unique index → an INSERT/UPDATE
-- that would create a second active row fails, which is why activation must
-- go through set_active_loading_screen (it clears the others first).
drop index if exists loading_screen_images_one_active;
create unique index loading_screen_images_one_active
  on public.loading_screen_images (is_active)
  where is_active;

drop trigger if exists loading_screen_images_updated_at on public.loading_screen_images;
create trigger loading_screen_images_updated_at
  before update on public.loading_screen_images
  for each row execute function public.set_updated_at();

drop trigger if exists loading_screen_images_audit_log on public.loading_screen_images;
create trigger loading_screen_images_audit_log
  after insert or update or delete on public.loading_screen_images
  for each row execute function private.log_admin_config_change();

/* -------------------------------------------------------------------------- */
/* RLS — read for everyone (the client needs the active URL), writes admin-only */
/* -------------------------------------------------------------------------- */

alter table public.loading_screen_images enable row level security;

grant select on public.loading_screen_images to anon, authenticated;
grant insert, update, delete on public.loading_screen_images to authenticated;

drop policy if exists "loading_screen_images_read_all" on public.loading_screen_images;
create policy "loading_screen_images_read_all"
  on public.loading_screen_images for select
  to anon, authenticated
  using (true);

drop policy if exists "loading_screen_images_insert_admin" on public.loading_screen_images;
create policy "loading_screen_images_insert_admin"
  on public.loading_screen_images for insert
  to authenticated
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "loading_screen_images_update_admin" on public.loading_screen_images;
create policy "loading_screen_images_update_admin"
  on public.loading_screen_images for update
  to authenticated
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "loading_screen_images_delete_admin" on public.loading_screen_images;
create policy "loading_screen_images_delete_admin"
  on public.loading_screen_images for delete
  to authenticated
  using (private.can_manage_config(auth.uid()));

/* -------------------------------------------------------------------------- */
/* set_active_loading_screen — flip which art is live, atomically             */
/* -------------------------------------------------------------------------- */

-- Two statements so the partial unique index never sees two active rows:
-- clear the others first, then activate the target. Admin-gated.
create or replace function public.set_active_loading_screen(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized';
  end if;

  update public.loading_screen_images
    set is_active = false, updated_by = auth.uid()
    where is_active and id <> p_id;

  update public.loading_screen_images
    set is_active = true, updated_by = auth.uid()
    where id = p_id;

  if not found then
    raise exception 'loading screen % not found', p_id;
  end if;
end;
$$;

grant execute on function public.set_active_loading_screen(uuid) to authenticated;

/* -------------------------------------------------------------------------- */
/* Seed — the bundled default art, set active so the BO list starts populated */
/* -------------------------------------------------------------------------- */

insert into public.loading_screen_images (name, image_url, is_active, sort_order)
select 'Default', '/loading/default.webp', true, 10
where not exists (select 1 from public.loading_screen_images);
