-- Lobby bottom-nav feature gating.
--
-- Mirrors board_theme_configs: each gatable bottom-nav feature (Missions,
-- Events, Tournaments, VIP Club) unlocks at a configurable level, editable in
-- the Back Office. The lobby reads this table to decide which nav slots show a
-- lock badge (+ "Reach level X" tooltip on tap), exactly like locked boards.
--
-- Seeded at unlock_level 1 (everything open) so deploying this is a no-op for
-- players until the operator raises a level in the BO. The center Hourly Bonus
-- wheel is deliberately NOT gated (core free reward), so it's not seeded here.

create table if not exists public.lobby_feature_configs (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null unique,
  label text not null,
  unlock_level integer not null default 1 check (unlock_level >= 1),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reuse the shared touch trigger (same one user_wallets / shop_items use).
drop trigger if exists lobby_feature_configs_updated_at on public.lobby_feature_configs;
create trigger lobby_feature_configs_updated_at
  before update on public.lobby_feature_configs
  for each row execute function public.set_updated_at();

-- RLS: public read, admin (owner/admin) write — identical to board_theme_configs.
grant select on public.lobby_feature_configs to anon, authenticated;
grant insert, update, delete on public.lobby_feature_configs to authenticated;

alter table public.lobby_feature_configs enable row level security;

drop policy if exists "lobby_feature_configs_read_all" on public.lobby_feature_configs;
create policy "lobby_feature_configs_read_all"
  on public.lobby_feature_configs for select
  using (true);

drop policy if exists "lobby_feature_configs_insert_admin" on public.lobby_feature_configs;
create policy "lobby_feature_configs_insert_admin"
  on public.lobby_feature_configs for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "lobby_feature_configs_update_admin" on public.lobby_feature_configs;
create policy "lobby_feature_configs_update_admin"
  on public.lobby_feature_configs for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "lobby_feature_configs_delete_admin" on public.lobby_feature_configs;
create policy "lobby_feature_configs_delete_admin"
  on public.lobby_feature_configs for delete
  using (private.can_manage_config(auth.uid()));

-- Seed the four gatable side-nav features, all open (level 1).
insert into public.lobby_feature_configs (feature_key, label, unlock_level, is_enabled, sort_order)
values
  ('missions',    'Missions',    1, true, 10),
  ('events',      'Events',      1, true, 20),
  ('tournaments', 'Tournaments', 1, true, 30),
  ('vip-club',    'VIP Club',    1, true, 40)
on conflict (feature_key) do nothing;
