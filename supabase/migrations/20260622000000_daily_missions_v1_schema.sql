-- Daily Missions v1 — schema, RLS, seed.
--
-- Phase 1 of the Daily Missions feature per docs/specs/daily-missions.md.
-- This migration creates:
--   • 13 new tables (reference data + metric infrastructure + per-player state)
--   • RLS policies (admin-write for reference, own-row-read for player state)
--   • Seed data (currencies, reroll pricing, chest milestones, v1 mission catalog)
--   • An extension of wallet_transactions.source_check for the new sources
--
-- This is purely schema + seed. The cron jobs that populate
-- player_metrics, metric_distributions, player_metric_tiers, and
-- player_daily_missions land in Phase 2 (20260623+). The RPCs that
-- read/write per-player state via SECURITY DEFINER land in Phase 4-5.
--
-- The design follows the project's established patterns:
--   • Math + coefficients in tables (not rules in code) — same shape
--     as the wheel and PP-calculator systems.
--   • Per-feature inventory tables (user_board_inventory etc.); the
--     new user_inventory is the generic ledger for future item types
--     that don't have their own table yet (avatar frames, etc.).
--   • Reference data world-readable, admin-writable via
--     private.can_manage_config; player state own-row readable,
--     RPC-only writable.

-- ============================================================
-- Section 1: currencies — registry for wallet currencies.
--
-- Adding a new currency later means: insert one row here, add one
-- column to user_wallets, add one branch to the credit-dispatch
-- Postgres function (built in Phase 4). The mission catalog
-- references currencies by code and is fully agnostic — so
-- authoring new mission rewards never requires a code change.
-- ============================================================
create table public.currencies (
  code text primary key,
  display_name text not null,
  icon_url text,
  is_enabled boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger currencies_updated_at
  before update on public.currencies
  for each row execute function public.set_updated_at();

-- XP is registered as a currency too even though it routes to
-- profiles.xp instead of user_wallets — same pattern the wheel
-- uses (see spin_wheel's reward_type CASE). Keeping it in the
-- registry means mission_rewards.currency_code = 'xp' is a valid,
-- BO-authorable reward shape; the Phase 4 credit function knows
-- 'xp' is the special-case route.
insert into public.currencies (code, display_name, icon_url, display_order) values
  ('coins', 'Coins', '/lobby/icons/gold-coin.webp', 10),
  ('gems',  'Gems',  '/lobby/icons/gem.webp',       20),
  ('xp',    'XP',    null,                          30);

-- ============================================================
-- Section 2: mission_templates + mission_rewards.
--
-- mission_templates is the authored catalog the BO operator
-- curates. Each row is one "shape" of mission. The Phase 3
-- assignment cron picks templates that match a player's
-- eligibility, resolves goal_value per resolution_mode, and
-- inserts a row into player_daily_missions.
--
-- resolution_mode:
--   'fixed'   → use goal_value directly. Use for missions where
--               X must be the same for everyone (e.g. "Spin the
--               wheel 1 time", "Level up 1 time", "Win 3 in a row"
--               — anywhere a personally-stretched X would either
--               trivialise the mission for whales or punish
--               casuals).
--   'stretch' → X = clamp(ceil(player_metrics.baseline_7d *
--               stretch_factor), goal_min, goal_max). Use for
--               personally-calibrated missions ("Play X matches"
--               where X is the player's typical day × 1.5).
--
-- goal_min / goal_max are the safety valve for stretch mode —
-- "Win X in a row" doesn't use stretch precisely because the
-- safety clamp would have to be so tight (max 5) that there's
-- no real range. Use fixed for streak-style mechanics.
--
-- params jsonb holds mission-type-specific context (e.g.
-- {"difficulty_id":"pro"} for "Play Pro Y times"). The Phase 4
-- progress_mission RPC reads this to know which events match
-- which missions.
--
-- eligibility jsonb is the assignment-time filter — common keys:
--   min_level, max_level, requires_unlocks (array of feature
--   slugs), requires_rated (bool).
-- ============================================================
create table public.mission_templates (
  id uuid primary key default gen_random_uuid(),
  mission_type text not null,
  metric_code text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic')),
  resolution_mode text not null check (resolution_mode in ('fixed', 'stretch')),
  goal_value int check (goal_value is null or goal_value > 0),
  stretch_factor numeric(5,2) check (stretch_factor is null or stretch_factor > 0),
  goal_min int not null default 1 check (goal_min >= 1),
  goal_max int not null default 999999 check (goal_max >= goal_min),
  eligibility jsonb not null default '{}'::jsonb,
  params jsonb not null default '{}'::jsonb,
  mission_points int not null default 0 check (mission_points >= 0),
  period text not null default 'daily' check (period in ('daily', 'weekly')),
  title text not null,
  subtitle text,
  icon_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one of goal_value or stretch_factor must be set,
  -- matching the resolution_mode. Without this constraint the
  -- assignment cron would have to guess which field to read.
  check (
    (resolution_mode = 'fixed'   and goal_value is not null and stretch_factor is null) or
    (resolution_mode = 'stretch' and stretch_factor is not null)
  )
);

create index mission_templates_pickable_idx
  on public.mission_templates (period, enabled, rarity);

create trigger mission_templates_updated_at
  before update on public.mission_templates
  for each row execute function public.set_updated_at();

-- mission_rewards — polymorphic reward bundle for a template.
-- Multiple rows per mission (a mission can pay out coins + XP +
-- gems + a board theme all at once). reward_kind drives which of
-- (currency_code) vs (item_table, item_id) is populated; the
-- check constraint enforces exactly one shape per row.
create table public.mission_rewards (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.mission_templates(id) on delete cascade,
  reward_kind text not null check (reward_kind in ('currency', 'item')),
  currency_code text references public.currencies(code),
  item_table text,
  item_id text,
  amount int not null default 1 check (amount > 0),
  display_order int not null default 0,
  created_at timestamptz not null default now(),

  check (
    (reward_kind = 'currency' and currency_code is not null and item_table is null and item_id is null) or
    (reward_kind = 'item'     and currency_code is null     and item_table is not null and item_id is not null)
  )
);

create index mission_rewards_mission_idx on public.mission_rewards (mission_id);

-- ============================================================
-- Section 3: chest_milestones + chest_rewards.
--
-- The weekly Mission Points pass. Hitting threshold_mp unlocks
-- the chest at that milestone_index; the player claims via the
-- claim_chest RPC (Phase 5). Chests reset weekly along with the
-- pass — see player_weekly_pass.chests_claimed.
-- ============================================================
create table public.chest_milestones (
  id uuid primary key default gen_random_uuid(),
  milestone_index int not null unique check (milestone_index >= 0),
  threshold_mp int not null check (threshold_mp > 0),
  display_name text not null,
  rarity text not null default 'common'
    check (rarity in ('common', 'rare', 'epic', 'legendary')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chest_milestones_updated_at
  before update on public.chest_milestones
  for each row execute function public.set_updated_at();

create table public.chest_rewards (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.chest_milestones(id) on delete cascade,
  reward_kind text not null check (reward_kind in ('currency', 'item')),
  currency_code text references public.currencies(code),
  item_table text,
  item_id text,
  amount int not null default 1 check (amount > 0),
  display_order int not null default 0,
  created_at timestamptz not null default now(),

  check (
    (reward_kind = 'currency' and currency_code is not null and item_table is null and item_id is null) or
    (reward_kind = 'item'     and currency_code is null     and item_table is not null and item_id is not null)
  )
);

create index chest_rewards_milestone_idx on public.chest_rewards (milestone_id);

-- Seed the 4 weekly chest milestones. Display names are styled
-- like progression tiers; operator can rename them in the BO.
insert into public.chest_milestones (milestone_index, threshold_mp, display_name, rarity) values
  (0,  25,  'Initiate''s Cache',  'common'),
  (1,  75,  'Veteran''s Hoard',   'rare'),
  (2, 150,  'Champion''s Vault',  'epic'),
  (3, 250,  'Grand Treasure',     'legendary');

-- ============================================================
-- Section 4: reroll_pricing_config — singleton row.
--
-- gem_cost_ladder[i] is the cost of the i-th reroll on a given
-- day (0-indexed). ladder[0] = 0 (first reroll is free per spec).
-- Rerolls beyond array length OR beyond daily_cap are blocked by
-- the reroll_mission RPC. Editing the ladder live takes effect
-- the next time a player rerolls — no migration needed.
-- ============================================================
create table public.reroll_pricing_config (
  id text primary key default 'default',
  gem_cost_ladder int[] not null default array[0, 25, 75, 200]::int[],
  daily_cap int not null default 4 check (daily_cap > 0),
  updated_at timestamptz not null default now()
);

create trigger reroll_pricing_config_updated_at
  before update on public.reroll_pricing_config
  for each row execute function public.set_updated_at();

insert into public.reroll_pricing_config (id) values ('default');

-- ============================================================
-- Section 5: metric infrastructure.
--
-- player_metrics:        per-player snapshot of each tracked
--                        metric. value_today resets at the daily
--                        recompute (Phase 2); baseline_7d is a
--                        rolling 7-day average used by stretch
--                        resolution and tier derivation.
-- metric_distributions:  population-level percentile breakpoints,
--                        recomputed nightly. Drives the casual /
--                        regular / whale tier boundaries.
-- player_metric_tiers:   derived nightly. Mission templates with
--                        a required_tier in their eligibility
--                        consult this table at assignment time.
-- ============================================================
create table public.player_metrics (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  metric_code text not null,
  value_today int not null default 0,
  baseline_7d numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, metric_code)
);

create index player_metrics_metric_idx on public.player_metrics (metric_code);

create table public.metric_distributions (
  metric_code text not null,
  percentile int not null check (percentile between 0 and 100),
  value numeric(12,2) not null,
  computed_at timestamptz not null default now(),
  primary key (metric_code, percentile)
);

create table public.player_metric_tiers (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  metric_code text not null,
  tier text not null check (tier in ('casual', 'regular', 'whale')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, metric_code)
);

create index player_metric_tiers_tier_idx on public.player_metric_tiers (metric_code, tier);

-- ============================================================
-- Section 6: per-player active state.
--
-- player_daily_missions:  the currently-active missions per
--                         player. v1 assigns 4 daily (1 always-
--                         Epic + 3 from Common/Rare pool) plus 1
--                         weekly. expires_at = end of the period
--                         (day for daily, ISO week for weekly).
--                         Unclaimed at expiry = LOST per spec.
-- player_weekly_pass:     one row per (player, ISO week).
--                         mp_earned increments on every mission
--                         claim; chests_claimed is a jsonb array
--                         of milestone_index values the player
--                         has claimed for that week.
-- player_streak:          one row per player. Tracks the rolling
--                         consecutive-days-of-full-completion
--                         counter that unlocks the 7-day streak
--                         chest.
-- ============================================================
create table public.player_daily_missions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_template_id uuid not null references public.mission_templates(id) on delete cascade,
  rarity_slot text not null check (rarity_slot in ('common', 'rare', 'epic')),
  resolved_goal int not null check (resolved_goal > 0),
  progress int not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  assigned_at timestamptz not null default now(),
  reroll_count_today int not null default 0 check (reroll_count_today >= 0),
  period text not null default 'daily' check (period in ('daily', 'weekly')),

  -- A mission cannot be claimed before it is completed. Prevents
  -- a race where a buggy client claims a mission whose completed_at
  -- hasn't been set yet.
  check (claimed_at is null or completed_at is not null)
);

create index player_daily_missions_profile_idx
  on public.player_daily_missions (profile_id, expires_at desc);
create index player_daily_missions_unclaimed_idx
  on public.player_daily_missions (profile_id, completed_at)
  where claimed_at is null;

create table public.player_weekly_pass (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_key text not null,  -- ISO week format like '2026-W21'
  mp_earned int not null default 0 check (mp_earned >= 0),
  chests_claimed jsonb not null default '[]'::jsonb,
  streak_bonus_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, week_key)
);

create index player_weekly_pass_week_idx on public.player_weekly_pass (week_key);

create trigger player_weekly_pass_updated_at
  before update on public.player_weekly_pass
  for each row execute function public.set_updated_at();

create table public.player_streak (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak_days int not null default 0 check (current_streak_days >= 0),
  last_complete_date date,
  total_streak_chests_claimed int not null default 0 check (total_streak_chests_claimed >= 0),
  updated_at timestamptz not null default now()
);

create trigger player_streak_updated_at
  before update on public.player_streak
  for each row execute function public.set_updated_at();

-- ============================================================
-- Section 7: user_inventory — generic polymorphic item grant ledger.
--
-- Existing per-feature inventory tables (user_board_inventory)
-- remain the source of truth for THEIR item types. user_inventory
-- is for item types that don't yet have a dedicated table —
-- avatar frames (future), event-locked cosmetics, etc.
--
-- The Phase 4 credit-dispatch function inserts here for item
-- types without a dedicated inventory table; it inserts into the
-- type-specific inventory table for known types (e.g. board
-- themes → user_board_inventory). The (profile_id, item_table,
-- item_id) unique constraint blocks duplicate ownership in a
-- single place.
-- ============================================================
create table public.user_inventory (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_table text not null,
  item_id text not null,
  granted_at timestamptz not null default now(),
  source text not null,
  source_ref_id text,

  unique (profile_id, item_table, item_id)
);

create index user_inventory_profile_idx on public.user_inventory (profile_id);

-- ============================================================
-- Section 8: extend wallet_transactions source check.
--
-- Adds the four new sources missions will write under. Pattern
-- copied from 20260618000000_wallet_transactions_wheel_spin_source.sql.
-- ============================================================
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_source_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_source_check
  check (source in (
    'admin_adjustment', 'match_reward', 'purchase', 'daily_bonus',
    'level_reward', 'refund', 'system', 'entry_fee', 'wheel_spin',
    'mission_reward', 'chest_reward', 'streak_chest_reward', 'mission_reroll_fee'
  ));

-- ============================================================
-- Section 9: RLS — reference data world-readable + admin-writable;
-- player state own-row readable + RPC-only writable.
-- ============================================================

-- Reference data: world-readable.
alter table public.currencies              enable row level security;
alter table public.mission_templates       enable row level security;
alter table public.mission_rewards         enable row level security;
alter table public.chest_milestones        enable row level security;
alter table public.chest_rewards           enable row level security;
alter table public.reroll_pricing_config   enable row level security;
alter table public.metric_distributions    enable row level security;

create policy currencies_read            on public.currencies            for select using (true);
create policy mission_templates_read     on public.mission_templates     for select using (true);
create policy mission_rewards_read       on public.mission_rewards       for select using (true);
create policy chest_milestones_read      on public.chest_milestones      for select using (true);
create policy chest_rewards_read         on public.chest_rewards         for select using (true);
create policy reroll_pricing_read        on public.reroll_pricing_config for select using (true);

-- metric_distributions is admin-only read — these are population
-- analytics, not consumer-facing data.
create policy metric_distributions_read on public.metric_distributions for select
  using (private.is_admin(auth.uid()));

-- All reference-data writes require can_manage_config (owner / admin).
create policy currencies_admin_write          on public.currencies            for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy mission_templates_admin_write   on public.mission_templates     for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy mission_rewards_admin_write     on public.mission_rewards       for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy chest_milestones_admin_write    on public.chest_milestones      for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy chest_rewards_admin_write       on public.chest_rewards         for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy reroll_pricing_admin_write      on public.reroll_pricing_config for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));
create policy metric_distributions_admin_write on public.metric_distributions for all
  using (private.can_manage_config(auth.uid())) with check (private.can_manage_config(auth.uid()));

-- Player state: own-row readable (plus admin read for BO support).
-- No write policies — writes happen exclusively through SECURITY
-- DEFINER RPCs added in Phase 4-5, which bypass RLS.
alter table public.player_metrics          enable row level security;
alter table public.player_metric_tiers     enable row level security;
alter table public.player_daily_missions   enable row level security;
alter table public.player_weekly_pass      enable row level security;
alter table public.player_streak           enable row level security;
alter table public.user_inventory          enable row level security;

create policy player_metrics_own_read         on public.player_metrics        for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));
create policy player_metric_tiers_own_read    on public.player_metric_tiers   for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));
create policy player_daily_missions_own_read  on public.player_daily_missions for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));
create policy player_weekly_pass_own_read     on public.player_weekly_pass    for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));
create policy player_streak_own_read          on public.player_streak         for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));
create policy user_inventory_own_read         on public.user_inventory        for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

-- ============================================================
-- Section 10: Initial mission catalog seed (~24 templates).
--
-- Spans the 11 mission concepts × Common/Rare/Epic variants
-- (with selective omissions where a variant doesn't make sense
-- — e.g. no Epic Level-Up because level-up cadence is too low for
-- a single-day Epic-tier goal). Plus 1 Weekly Challenge.
--
-- Reward magnitudes, MP values, and stretch factors are STARTER
-- DEFAULTS — the BO operator tunes these during Phase 8's internal
-- dark-launch. Convention:
--   Common MP = 10, reward ≈ 250 coins or 10 XP.
--   Rare   MP = 25, reward ≈ 500 coins + 20 XP, OR ≈ 10 gems.
--   Epic   MP = 50, reward ≈ 1-2K coins + 50 XP, OR ≈ 20-25 gems.
--   Weekly MP = 100, reward ≈ 100 gems + 5K coins + 50 XP.
--
-- One perfect daily slate (2C + 1R + 1E) = 95 MP/day = 665/week,
-- comfortably clearing all four chest milestones (25/75/150/250).
-- The +10% streak bonus pads on top.
-- ============================================================

do $$
declare
  tid uuid;
begin

  -- ────────────────────────────────────────────────────────────
  -- Concept 1: Play X matches (stretch — auto-calibrated)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('play_matches', 'matches_per_day', 'common', 'stretch',
     1.20, 1, 3, 10,
     'Play matches', 'Jump into any match.', '/lobby/icons/online-players.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 250, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('play_matches', 'matches_per_day', 'rare', 'stretch',
     1.50, 2, 6, 25,
     'Play matches', 'Keep the dice rolling.', '/lobby/icons/online-players.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order) values
    (tid, 'currency', 'coins', 500, 0),
    (tid, 'currency', 'xp',    20,  1);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('play_matches', 'matches_per_day', 'epic', 'stretch',
     2.00, 4, 12, 50,
     'Marathon session', 'A serious play session today.', '/lobby/icons/online-players.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order) values
    (tid, 'currency', 'coins', 1500, 0),
    (tid, 'currency', 'gems',  10,   1),
    (tid, 'currency', 'xp',    50,   2);

  -- ────────────────────────────────────────────────────────────
  -- Concept 2: Win X in a row (fixed — streak math is too risky for stretch)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('win_streak', 'win_streak', 'common', 'fixed',
     2, 10, 'Win streak', 'Win 2 matches in a row.', '/lobby/icons/trophy.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 300, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('win_streak', 'win_streak', 'rare', 'fixed',
     3, 25, 'Win streak', 'Win 3 matches in a row.', '/lobby/icons/trophy.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('win_streak', 'win_streak', 'epic', 'fixed',
     5, 50, 'Unbeatable', 'Get a 5-match win streak.', '/lobby/icons/trophy.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'gems', 20, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 3: Level up X times (fixed; capped at level 25 via eligibility
  -- because higher-level progression is too slow for daily-mission cadence)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, eligibility, mission_points, title, subtitle, icon_url)
  values
    ('level_up', 'levels_per_week', 'common', 'fixed',
     1, '{"max_level": 25}'::jsonb, 10,
     'Level up', 'Earn enough XP to reach the next level.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 200, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, eligibility, mission_points, title, subtitle, icon_url)
  values
    ('level_up', 'levels_per_week', 'rare', 'fixed',
     2, '{"max_level": 25}'::jsonb, 25,
     'Climb the ladder', 'Reach 2 new levels.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 4: Play difficulty Y, X times (per-difficulty templates
  -- added by operator via BO; one example seed for Beginner)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, params, eligibility, mission_points, title, subtitle, icon_url)
  values
    ('play_difficulty', 'matches_per_day', 'common', 'fixed',
     2, '{"difficulty_id": "beginner"}'::jsonb, '{}'::jsonb, 10,
     'Beginner bouts', 'Play 2 Beginner matches.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 250, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 5: Wager X coins (stretch — calibrated to entry-fee habit)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('wager_coins', 'coins_wagered_per_day', 'common', 'stretch',
     1.10, 50, 500, 10,
     'Place your bets', 'Wager coins across matches today.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 200, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('wager_coins', 'coins_wagered_per_day', 'rare', 'stretch',
     1.50, 200, 2000, 25,
     'Big spender', 'Wager more than your usual today.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('wager_coins', 'coins_wagered_per_day', 'epic', 'stretch',
     2.00, 1000, 10000, 50,
     'High roller', 'Lay down serious money today.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'gems', 20, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 6: Win X coins net (stretch)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('win_coins_net', 'coins_won_net_per_day', 'common', 'stretch',
     1.10, 50, 500, 10,
     'Net positive', 'Finish the day in the green.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 250, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('win_coins_net', 'coins_won_net_per_day', 'rare', 'stretch',
     1.30, 200, 1500, 25,
     'On a roll', 'Win more coins than your typical day.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('win_coins_net', 'coins_won_net_per_day', 'epic', 'stretch',
     1.80, 500, 5000, 50,
     'Crushing it', 'Have an exceptional day.', '/lobby/icons/gold-coin.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 1500, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 7: Earn X XP (stretch, cross-cutting — every source counts)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('earn_xp', 'xp_per_day', 'common', 'stretch',
     1.20, 10, 100, 10,
     'Earn XP', 'Any activity earns XP — keep grinding.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 200, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('earn_xp', 'xp_per_day', 'rare', 'stretch',
     1.50, 30, 250, 25,
     'XP push', 'Stretch your XP gain today.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     stretch_factor, goal_min, goal_max, mission_points,
     title, subtitle, icon_url)
  values
    ('earn_xp', 'xp_per_day', 'epic', 'stretch',
     2.00, 75, 600, 50,
     'XP marathon', 'Double-down on XP gains today.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 1500, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 8: Spin the wheel X times (fixed — habit reinforcement)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('spin_wheel', 'wheel_spins_per_day', 'common', 'fixed',
     1, 10, 'Take a spin', 'Claim your Hourly Bonus.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 150, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 9: Spend X gems (fixed — explicit gem sink, monetization)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('spend_gems', 'gems_spent_per_day', 'common', 'fixed',
     5, 15, 'Spend gems', 'Use gems in the shop or rerolls.', '/lobby/icons/gem.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 300, 0);

  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('spend_gems', 'gems_spent_per_day', 'rare', 'fixed',
     25, 35, 'Big gem day', 'Treat yourself.', '/lobby/icons/gem.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 1000, 0);

  -- ────────────────────────────────────────────────────────────
  -- Concept 10: Beat a higher-rated opponent (Epic only, rated-only)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, eligibility, mission_points, title, subtitle, icon_url)
  values
    ('beat_higher_rated', 'rating_diff_won', 'epic', 'fixed',
     1, '{"requires_rated": true}'::jsonb, 50,
     'Punching up', 'Beat a higher-rated opponent.', '/lobby/icons/trophy.webp')
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order) values
    (tid, 'currency', 'gems',  25, 0),
    (tid, 'currency', 'coins', 500, 1);

  -- ────────────────────────────────────────────────────────────
  -- Concept 11: Complete N other daily missions (meta — encourages full slate)
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, mission_points, title, subtitle, icon_url)
  values
    ('meta_complete_missions', 'missions_claimed_per_day', 'common', 'fixed',
     3, 20, 'Mission stack', 'Complete 3 of your other daily missions.', null)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order)
  values (tid, 'currency', 'coins', 500, 0);

  -- ────────────────────────────────────────────────────────────
  -- Weekly Challenge — single template, period='weekly'
  -- ────────────────────────────────────────────────────────────
  insert into public.mission_templates
    (mission_type, metric_code, rarity, resolution_mode,
     goal_value, period, mission_points,
     title, subtitle, icon_url, eligibility)
  values
    ('weekly_ranked_wins', 'ranked_wins_per_week', 'epic', 'fixed',
     15, 'weekly', 100,
     'Win 15 ranked matches', 'Prove your skill on the board.',
     '/lobby/icons/trophy.webp', '{"requires_rated": true}'::jsonb)
  returning id into tid;
  insert into public.mission_rewards (mission_id, reward_kind, currency_code, amount, display_order) values
    (tid, 'currency', 'gems',  100,  0),
    (tid, 'currency', 'coins', 5000, 1);

end;
$$;

-- ============================================================
-- Section 11: Chest reward seed.
--
-- Bundles per chest milestone. Cosmetic items (board themes) can
-- be added via the BO once the operator decides which boards to
-- include — for v1 we ship pure currency bundles.
-- ============================================================
do $$
declare
  m_id uuid;
begin
  -- Milestone 0 (25 MP): Initiate's Cache
  select id into m_id from public.chest_milestones where milestone_index = 0;
  insert into public.chest_rewards (milestone_id, reward_kind, currency_code, amount, display_order) values
    (m_id, 'currency', 'coins', 500, 0);

  -- Milestone 1 (75 MP): Veteran's Hoard
  select id into m_id from public.chest_milestones where milestone_index = 1;
  insert into public.chest_rewards (milestone_id, reward_kind, currency_code, amount, display_order) values
    (m_id, 'currency', 'coins', 1500, 0),
    (m_id, 'currency', 'gems',  10,   1);

  -- Milestone 2 (150 MP): Champion's Vault
  select id into m_id from public.chest_milestones where milestone_index = 2;
  insert into public.chest_rewards (milestone_id, reward_kind, currency_code, amount, display_order) values
    (m_id, 'currency', 'coins', 5000, 0),
    (m_id, 'currency', 'gems',  25,   1);

  -- Milestone 3 (250 MP): Grand Treasure
  select id into m_id from public.chest_milestones where milestone_index = 3;
  insert into public.chest_rewards (milestone_id, reward_kind, currency_code, amount, display_order) values
    (m_id, 'currency', 'coins', 10000, 0),
    (m_id, 'currency', 'gems',  100,   1);
end;
$$;

-- ============================================================
-- End of Phase 1 schema migration.
--
-- Next: Phase 2 — nightly metric + tier recompute cron
-- (20260623000000_daily_missions_v2_metric_cron.sql)
-- ============================================================
