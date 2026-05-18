-- Daily Bonus foundation: configs (Back-Office-managed) + per-player state.
-- This is PR 1 — schema only. RPCs (claim_daily_bonus, admin_preview)
-- ship in a follow-up. Tables are additive; no existing code references
-- them yet.

-- ---------------------------------------------------------------------------
-- daily_bonus_configs: 7 rows, one per day (1..7). Managed via Back Office.
-- Currency rewards live as int columns (hot path, easy to sum); non-currency
-- grants (board theme unlocks, future cosmetics) go in `reward_items jsonb`
-- to mirror level_configs.reward_items.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_bonus_configs (
  day int primary key check (day between 1 and 7),
  reward_coins int not null default 0 check (reward_coins >= 0),
  reward_gems int not null default 0 check (reward_gems >= 0),
  reward_xp int not null default 0 check (reward_xp >= 0),
  reward_items jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists daily_bonus_configs_updated_at on public.daily_bonus_configs;
create trigger daily_bonus_configs_updated_at
  before update on public.daily_bonus_configs
  for each row execute function public.set_updated_at();

alter table public.daily_bonus_configs enable row level security;

-- Anyone (even unauthenticated) can read the configs so the modal can
-- preview future-day rewards. Writes are admin-only.
drop policy if exists "daily_bonus_configs_select_all" on public.daily_bonus_configs;
create policy "daily_bonus_configs_select_all"
  on public.daily_bonus_configs for select
  using (true);

drop policy if exists "daily_bonus_configs_write_admin" on public.daily_bonus_configs;
create policy "daily_bonus_configs_write_admin"
  on public.daily_bonus_configs for all
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- Seed all 7 days with zero rewards. Operator fills these in via the
-- Back Office (PR 5).
insert into public.daily_bonus_configs (day)
select generate_series(1, 7)
on conflict (day) do nothing;

-- ---------------------------------------------------------------------------
-- user_daily_bonuses: one row per player tracking the streak state.
-- `current_day` is the day to claim *next* (1..7). `last_claim_date_et`
-- is the ET calendar date of the last successful claim — the only thing
-- the streak-boundary check reads. `last_claim_at` is kept for analytics.
-- ---------------------------------------------------------------------------
create table if not exists public.user_daily_bonuses (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  current_day int not null default 1 check (current_day between 1 and 7),
  last_claim_date_et date,
  last_claim_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_daily_bonuses_updated_at on public.user_daily_bonuses;
create trigger user_daily_bonuses_updated_at
  before update on public.user_daily_bonuses
  for each row execute function public.set_updated_at();

alter table public.user_daily_bonuses enable row level security;

-- Players read their own row. Admins can read any row. Writes happen
-- only through the claim_daily_bonus RPC (security definer) or admin
-- tooling — no client-side mutation policy is exposed here.
drop policy if exists "user_daily_bonuses_select_own_or_admin" on public.user_daily_bonuses;
create policy "user_daily_bonuses_select_own_or_admin"
  on public.user_daily_bonuses for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "user_daily_bonuses_write_admin" on public.user_daily_bonuses;
create policy "user_daily_bonuses_write_admin"
  on public.user_daily_bonuses for all
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- ---------------------------------------------------------------------------
-- Auto-create a daily-bonus row when a profile is created. Mirrors the
-- existing `profiles_create_wallet` trigger pattern.
-- ---------------------------------------------------------------------------
create or replace function private.ensure_user_daily_bonus()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_daily_bonuses (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_create_daily_bonus on public.profiles;
create trigger profiles_create_daily_bonus
  after insert on public.profiles
  for each row execute function private.ensure_user_daily_bonus();

-- Backfill: every existing profile gets a default row.
insert into public.user_daily_bonuses (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Expand the user_board_inventory.source CHECK so the upcoming
-- claim_daily_bonus RPC can grant boards with source='daily_bonus'.
-- ---------------------------------------------------------------------------
alter table public.user_board_inventory
  drop constraint if exists user_board_inventory_source_check;

alter table public.user_board_inventory
  add constraint user_board_inventory_source_check
  check (source in ('default', 'purchase', 'level_reward', 'admin_grant', 'bundle', 'daily_bonus'));
