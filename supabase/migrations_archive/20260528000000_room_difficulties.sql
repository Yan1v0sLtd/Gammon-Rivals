-- Room difficulties — schema layer for the new "Select Room Difficulty"
-- modal in the lobby. We don't create a parallel table here: the
-- existing public.table_configs already carries entry_fee_coins,
-- prize_coins, required_level, match_target — adding four columns to
-- it is cleaner than maintaining two near-identical tables.
--
-- Columns added:
--   kind              — 'standard' (existing rows: practice/online/hotseat
--                       cards in the lobby left column) | 'difficulty'
--                       (the five Beginner..Grand Master tiers shown in
--                       the new modal). The BO "Difficulties" section
--                       filters table_configs by kind='difficulty'.
--   xp_multiplier_pct — Display + math percentage. 100 = ×1, 500 = ×5.
--                       The match-end XP grant multiplies by this/100.
--   base_xp_win       — Raw XP awarded for a win in this room, before the
--                       multiplier and before the player's user_xp_boosts
--                       buff is applied. Letting BO tune the base
--                       separately from the multiplier means we can keep
--                       the marketing % the same while raising real XP.
--   turn_seconds      — Per-turn time limit. Replaces the hard-coded
--                       DEFAULT_TURN_SECONDS=45 in HotSeat.tsx. Clamped
--                       in the modal/UI to the range below so the BO
--                       can't accidentally set a 1-second room.
--   accent_color      — Slug ('green' | 'blue' | 'purple' | 'red' |
--                       'gold' for the five tiers). Read by the modal
--                       card to pick its frame colours. Free-form so
--                       new tiers can pick new colour slugs without a
--                       schema change.
--
-- We also add matches.table_config_id (nullable FK) so the per-room
-- turn timer + XP multiplier + reward coins all stay reachable from
-- the match row at match-end without re-querying by id.

alter table public.table_configs
  add column kind text not null default 'standard'
    check (kind in ('standard', 'difficulty')),
  add column xp_multiplier_pct int not null default 100
    check (xp_multiplier_pct between 0 and 10000),
  add column base_xp_win int not null default 0
    check (base_xp_win >= 0),
  add column turn_seconds int not null default 45
    check (turn_seconds between 5 and 600),
  add column accent_color text not null default 'gold';

create index if not exists table_configs_kind_sort_idx
  on public.table_configs (kind, is_enabled, sort_order);

alter table public.matches
  add column table_config_id text references public.table_configs(id) on delete set null;

create index if not exists matches_table_config_id_idx
  on public.matches (table_config_id);

comment on column public.table_configs.kind is
  'Distinguishes ad-hoc rooms (standard: Practice AI, Play Online, etc.) from the five-tier difficulty ladder shown in the lobby modal.';
comment on column public.table_configs.xp_multiplier_pct is
  'Percent multiplier applied to base_xp_win on a win (100 = x1, 500 = x5). Displayed as the "XP BOOST" value on the difficulty card.';
comment on column public.table_configs.base_xp_win is
  'Raw XP credited for a win in this room before the multiplier and the player''s user_xp_boosts buff.';
comment on column public.table_configs.turn_seconds is
  'Per-turn time limit for matches created in this room. Overrides the legacy DEFAULT_TURN_SECONDS client constant.';
comment on column public.table_configs.accent_color is
  'Free-form accent slug consumed by the modal card frame (e.g. green/blue/purple/red/gold).';
comment on column public.matches.table_config_id is
  'Difficulty/room this match was started from. Used at match-end to look up turn timer, XP multiplier, and coin reward.';

-- Seed the five difficulty rows shown in the mockup.
insert into public.table_configs
  (id, kind, display_name, description, sort_order, is_enabled,
   entry_fee_coins, prize_coins, required_level, match_target,
   allow_ai, allow_online,
   xp_multiplier_pct, base_xp_win, turn_seconds, accent_color, metadata)
values
  ('difficulty-beginner', 'difficulty', 'Beginner',
   'Warm-up tier with the smallest stakes.',
   100, true,
   1000, 0, 1, 5,
   true, true,
   100, 50, 15, 'green',
   '{}'::jsonb),
  ('difficulty-advanced', 'difficulty', 'Advanced',
   'Steeper stakes for confident players.',
   110, true,
   2500, 0, 3, 7,
   true, true,
   250, 50, 30, 'blue',
   '{}'::jsonb),
  ('difficulty-pro', 'difficulty', 'Pro',
   'Where the real points start to add up.',
   120, true,
   10000, 0, 5, 7,
   true, true,
   500, 50, 45, 'purple',
   '{}'::jsonb),
  ('difficulty-expert', 'difficulty', 'Expert',
   'High-roller tier with long, deliberate turns.',
   130, true,
   50000, 0, 10, 9,
   true, true,
   750, 50, 60, 'red',
   '{}'::jsonb),
  ('difficulty-grand-master', 'difficulty', 'Grand Master',
   'The deepest stakes in the room.',
   140, true,
   150000, 0, 20, 11,
   true, true,
   1000, 50, 90, 'gold',
   '{}'::jsonb)
on conflict (id) do update set
  kind = excluded.kind,
  display_name = excluded.display_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled,
  entry_fee_coins = excluded.entry_fee_coins,
  prize_coins = excluded.prize_coins,
  required_level = excluded.required_level,
  match_target = excluded.match_target,
  allow_ai = excluded.allow_ai,
  allow_online = excluded.allow_online,
  xp_multiplier_pct = excluded.xp_multiplier_pct,
  base_xp_win = excluded.base_xp_win,
  turn_seconds = excluded.turn_seconds,
  accent_color = excluded.accent_color,
  updated_at = now();
