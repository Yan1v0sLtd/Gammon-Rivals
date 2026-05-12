-- Back Office V1 foundation.
-- Adds protected admin roles, game configuration tables, and an audit trail.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Admin roles
-- ---------------------------------------------------------------------------
create table if not exists public.admin_roles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'support', 'viewer')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists admin_roles_updated_at on public.admin_roles;
create trigger admin_roles_updated_at
  before update on public.admin_roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Admin access helpers. Kept outside the exposed public schema.
-- ---------------------------------------------------------------------------
create or replace function private.is_admin(check_profile_id uuid)
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
      and role in ('owner', 'admin', 'support', 'viewer')
  );
$$;

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

revoke all on function private.is_admin(uuid) from public;
revoke all on function private.can_manage_config(uuid) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin(uuid) to anon, authenticated;
grant execute on function private.can_manage_config(uuid) to anon, authenticated;

alter table public.admin_roles enable row level security;

drop policy if exists "admin_roles_select_self_or_admin" on public.admin_roles;
create policy "admin_roles_select_self_or_admin"
  on public.admin_roles for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "admin_roles_insert_by_owner_admin" on public.admin_roles;
create policy "admin_roles_insert_by_owner_admin"
  on public.admin_roles for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "admin_roles_update_by_owner_admin" on public.admin_roles;
create policy "admin_roles_update_by_owner_admin"
  on public.admin_roles for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "admin_roles_delete_by_owner_admin" on public.admin_roles;
create policy "admin_roles_delete_by_owner_admin"
  on public.admin_roles for delete
  using (private.can_manage_config(auth.uid()));

-- Bootstrap the first admin from the Supabase SQL editor or service role:
-- insert into public.admin_roles (profile_id, role, note)
-- values ('<profile uuid>', 'owner', 'Initial owner');

-- ---------------------------------------------------------------------------
-- Level System config
-- ---------------------------------------------------------------------------
create table if not exists public.level_configs (
  level int primary key check (level > 0),
  xp_required int not null check (xp_required >= 0),
  reward_coins int not null default 0 check (reward_coins >= 0),
  reward_gems int not null default 0 check (reward_gems >= 0),
  reward_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reward_items) = 'array'),
  unlock_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(unlock_rules) = 'object'),
  is_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists level_configs_updated_at on public.level_configs;
create trigger level_configs_updated_at
  before update on public.level_configs
  for each row execute function public.set_updated_at();

alter table public.level_configs enable row level security;

drop policy if exists "level_configs_read_all" on public.level_configs;
create policy "level_configs_read_all"
  on public.level_configs for select
  using (true);

drop policy if exists "level_configs_insert_admin" on public.level_configs;
create policy "level_configs_insert_admin"
  on public.level_configs for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "level_configs_update_admin" on public.level_configs;
create policy "level_configs_update_admin"
  on public.level_configs for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "level_configs_delete_admin" on public.level_configs;
create policy "level_configs_delete_admin"
  on public.level_configs for delete
  using (private.can_manage_config(auth.uid()));

-- ---------------------------------------------------------------------------
-- Tables / Rooms config
-- ---------------------------------------------------------------------------
create table if not exists public.table_configs (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]*$'),
  display_name text not null,
  description text not null default '',
  entry_fee_coins int not null default 0 check (entry_fee_coins >= 0),
  prize_coins int not null default 0 check (prize_coins >= 0),
  required_level int not null default 1 check (required_level > 0),
  match_target int not null default 7 check (match_target > 0),
  allow_ai boolean not null default false,
  allow_online boolean not null default true,
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists table_configs_enabled_sort_idx
  on public.table_configs (is_enabled, sort_order, required_level);

drop trigger if exists table_configs_updated_at on public.table_configs;
create trigger table_configs_updated_at
  before update on public.table_configs
  for each row execute function public.set_updated_at();

alter table public.table_configs enable row level security;

drop policy if exists "table_configs_read_all" on public.table_configs;
create policy "table_configs_read_all"
  on public.table_configs for select
  using (true);

drop policy if exists "table_configs_insert_admin" on public.table_configs;
create policy "table_configs_insert_admin"
  on public.table_configs for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "table_configs_update_admin" on public.table_configs;
create policy "table_configs_update_admin"
  on public.table_configs for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "table_configs_delete_admin" on public.table_configs;
create policy "table_configs_delete_admin"
  on public.table_configs for delete
  using (private.can_manage_config(auth.uid()));

-- ---------------------------------------------------------------------------
-- Board Themes config
-- ---------------------------------------------------------------------------
create table if not exists public.board_theme_configs (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]*$'),
  display_name text not null,
  preview_image text not null,
  gameplay_image text not null,
  lobby_background_image text,
  unlock_level int not null default 1 check (unlock_level > 0),
  price_coins int not null default 0 check (price_coins >= 0),
  is_enabled boolean not null default true,
  is_featured boolean not null default false,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_theme_configs_enabled_sort_idx
  on public.board_theme_configs (is_enabled, sort_order, unlock_level);

drop trigger if exists board_theme_configs_updated_at on public.board_theme_configs;
create trigger board_theme_configs_updated_at
  before update on public.board_theme_configs
  for each row execute function public.set_updated_at();

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

-- ---------------------------------------------------------------------------
-- Admin audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_table text not null,
  entity_id text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_recent_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_entity_idx
  on public.admin_audit_log (entity_table, entity_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_select_admin" on public.admin_audit_log;
create policy "admin_audit_log_select_admin"
  on public.admin_audit_log for select
  using (private.is_admin(auth.uid()));

drop policy if exists "admin_audit_log_insert_admin" on public.admin_audit_log;
create policy "admin_audit_log_insert_admin"
  on public.admin_audit_log for insert
  with check (private.can_manage_config(auth.uid()));

-- ---------------------------------------------------------------------------
-- Starter config seed data.
-- ---------------------------------------------------------------------------
insert into public.level_configs
  (level, xp_required, reward_coins, reward_gems, reward_items, unlock_rules)
values
  (1, 0, 0, 0, '[]', '{}'),
  (2, 100, 250, 0, '[]', '{"unlocks":["practice-ai"]}'),
  (3, 260, 350, 0, '[]', '{"unlocks":["online-casual"]}'),
  (4, 520, 500, 0, '[]', '{}'),
  (5, 900, 750, 1, '[]', '{"unlocks":["ocean-blue"]}'),
  (6, 1400, 900, 1, '[]', '{}'),
  (7, 2050, 1100, 2, '[]', '{"unlocks":["tournament-warmup"]}'),
  (8, 2850, 1300, 2, '[]', '{}'),
  (9, 3800, 1600, 3, '[]', '{}'),
  (10, 5000, 2000, 5, '[]', '{"unlocks":["royal-purple"]}')
on conflict (level) do nothing;

insert into public.table_configs
  (
    id,
    display_name,
    description,
    entry_fee_coins,
    prize_coins,
    required_level,
    match_target,
    allow_ai,
    allow_online,
    is_enabled,
    sort_order,
    metadata
  )
values
  (
    'practice-ai',
    'Practice AI',
    'Warm up against Bailey.',
    0,
    50,
    1,
    7,
    true,
    false,
    true,
    10,
    '{"difficulty":"medium"}'
  ),
  (
    'hotseat-friends',
    'Play Friends',
    'Two players on this device.',
    0,
    0,
    1,
    7,
    false,
    false,
    true,
    20,
    '{"mode":"hotseat"}'
  ),
  (
    'online-casual',
    'Play Online',
    'Challenge players around the world.',
    100,
    180,
    3,
    7,
    false,
    true,
    true,
    30,
    '{"mode":"online"}'
  ),
  (
    'tournament-warmup',
    'Tournaments',
    'Warm up against Bailey.',
    500,
    950,
    7,
    11,
    true,
    true,
    false,
    40,
    '{"comingSoon":true}'
  )
on conflict (id) do nothing;

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
    '{"accent":"#6dda72"}'
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
    '{"accent":"#39d7ff"}'
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
    '{"accent":"#c174ff"}'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Audit trigger for admin-managed config after the seed rows are inserted.
-- ---------------------------------------------------------------------------
create or replace function private.log_admin_config_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  target_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    before_row := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    after_row := to_jsonb(new);
  end if;

  target_id := coalesce(
    after_row ->> 'id',
    after_row ->> 'profile_id',
    after_row ->> 'level',
    before_row ->> 'id',
    before_row ->> 'profile_id',
    before_row ->> 'level',
    ''
  );

  insert into public.admin_audit_log
    (actor_profile_id, action, entity_table, entity_id, before_value, after_value)
  values
    (auth.uid(), lower(tg_op), tg_table_name, target_id, before_row, after_row);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.log_admin_config_change() from public;

drop trigger if exists admin_roles_audit_log on public.admin_roles;
create trigger admin_roles_audit_log
  after insert or update or delete on public.admin_roles
  for each row execute function private.log_admin_config_change();

drop trigger if exists level_configs_audit_log on public.level_configs;
create trigger level_configs_audit_log
  after insert or update or delete on public.level_configs
  for each row execute function private.log_admin_config_change();

drop trigger if exists table_configs_audit_log on public.table_configs;
create trigger table_configs_audit_log
  after insert or update or delete on public.table_configs
  for each row execute function private.log_admin_config_change();

drop trigger if exists board_theme_configs_audit_log on public.board_theme_configs;
create trigger board_theme_configs_audit_log
  after insert or update or delete on public.board_theme_configs
  for each row execute function private.log_admin_config_change();

-- Admin dashboard visibility over existing gameplay data.
drop policy if exists "matches_read" on public.matches;
create policy "matches_read"
  on public.matches for select
  using (
    private.is_admin(auth.uid())
    or finished_at is not null
    or owner_id = auth.uid()
    or opponent_id = auth.uid()
    or (mode = 'online' and is_public = true)
    or (
      mode = 'online'
      and opponent_id is null
      and invite_code is not null
      and (invite_expires_at is null or invite_expires_at > now())
    )
  );

drop policy if exists "games_read_via_match" on public.games;
create policy "games_read_via_match"
  on public.games for select
  using (
    private.is_admin(auth.uid())
    or match_id in (
      select id from public.matches
      where finished_at is not null
        or owner_id = auth.uid()
        or opponent_id = auth.uid()
        or (mode = 'online' and is_public = true)
    )
  );

drop policy if exists "moves_read_via_game" on public.moves;
create policy "moves_read_via_game"
  on public.moves for select
  using (
    private.is_admin(auth.uid())
    or game_id in (
      select g.id from public.games g
      join public.matches m on g.match_id = m.id
      where m.finished_at is not null
        or m.owner_id = auth.uid()
        or m.opponent_id = auth.uid()
        or (m.mode = 'online' and m.is_public = true)
    )
  );
