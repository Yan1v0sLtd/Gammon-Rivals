-- Repair/guarantee Back Office write access for board theme management.
-- The admin UI writes through the normal authenticated Supabase client, so
-- the table needs both Data API grants and RLS policies for owner/admin users.

create schema if not exists private;

create or replace function private.can_manage_config(check_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_roles
    where profile_id = check_profile_id
      and role in ('owner', 'admin')
  );
$$;

grant usage on schema private to anon, authenticated;
grant execute on function private.can_manage_config(uuid) to anon, authenticated;

grant select on public.board_theme_configs to anon, authenticated;
grant insert, update, delete on public.board_theme_configs to authenticated;

alter table public.board_theme_configs enable row level security;

drop policy if exists "board_theme_configs_read_all" on public.board_theme_configs;
create policy "board_theme_configs_read_all"
  on public.board_theme_configs for select
  using (true);

drop policy if exists "board_theme_configs_insert_admin" on public.board_theme_configs;
create policy "board_theme_configs_insert_admin"
  on public.board_theme_configs for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "board_theme_configs_update_admin" on public.board_theme_configs;
create policy "board_theme_configs_update_admin"
  on public.board_theme_configs for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "board_theme_configs_delete_admin" on public.board_theme_configs;
create policy "board_theme_configs_delete_admin"
  on public.board_theme_configs for delete
  using (private.can_manage_config(auth.uid()));

insert into public.board_theme_configs
  (
    id,
    display_name,
    preview_image,
    gameplay_image,
    lobby_background_image,
    unlock_level,
    price_coins,
    is_enabled,
    is_featured,
    sort_order,
    metadata
  )
values
  (
    'classic-green',
    'Classic Green',
    '/lobby/board-previews/classic-green.webp',
    '/themes/classic-green/board.webp',
    '/lobby/backgrounds/classic-green.webp',
    1,
    0,
    true,
    true,
    10,
    '{"accent":"#6dda72","subtitle":"Traditional felt"}'
  ),
  (
    'ocean-blue',
    'Ocean Blue',
    '/lobby/board-previews/ocean-blue.webp',
    '/themes/ocean-blue/board.webp',
    '/lobby/backgrounds/ocean-blue.webp',
    5,
    1500,
    true,
    false,
    20,
    '{"accent":"#39d7ff","subtitle":"Bright coastal wood"}'
  ),
  (
    'royal-purple',
    'Royal Purple',
    '/lobby/board-previews/royal-purple.webp',
    '/themes/royal-purple/board.webp',
    '/lobby/backgrounds/royal-purple.webp',
    10,
    5000,
    true,
    false,
    30,
    '{"accent":"#c174ff","subtitle":"Gold tournament trim"}'
  )
on conflict (id) do update
set
  display_name = excluded.display_name,
  preview_image = excluded.preview_image,
  gameplay_image = excluded.gameplay_image,
  lobby_background_image = excluded.lobby_background_image,
  unlock_level = excluded.unlock_level,
  price_coins = excluded.price_coins,
  is_enabled = excluded.is_enabled,
  is_featured = excluded.is_featured,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata;
