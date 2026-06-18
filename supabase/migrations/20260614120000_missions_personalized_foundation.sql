-- Personalized missions — FOUNDATION (read-only; nothing wired into the live
-- engine yet, so applying this changes no player-facing behavior).
--
-- Adds: the adaptive-difficulty controller state table, and a read-only
-- generator preview for the "Play matches" type that computes focus tier +
-- baseline + goal + self-funding reward. Used to validate the math on real
-- activity before integrating into assignment/progress/claim.
-- See docs/daily-missions-redesign.md.

-- Controller state, per (player, mission_type). Server-only (RLS on, no policy
-- → reachable only by SECURITY DEFINER funcs / service role).
create table if not exists public.player_mission_difficulty (
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  mission_type          text not null,
  target                int  not null,
  last_completed_target int,
  consecutive_misses    int  not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (profile_id, mission_type)
);
alter table public.player_mission_difficulty enable row level security;
comment on table public.player_mission_difficulty is
  'Adaptive-difficulty controller state per (player, mission_type): current target, last completed target, consecutive misses. Drives the personalized goal; server-only.';

-- Read-only generator preview for "Play matches". Computes, for a profile:
--   focus  = most-played ranked-difficulty tier in the window (recency tiebreak)
--   baseline = median finished matches per ACTIVE day in the window
--   goal   = clamp(ceil(baseline * stretch))           [cold-start; controller added later]
--   reward = round50(max(floor, b * goal * fee * (1-RTP)))  [self-funding]
-- Coefficients are inline here; they become per-type config when integrated.
create or replace function public.mp_play_matches_preview(p_profile_id uuid)
returns table (
  focus_tier text,
  focus_label text,
  window_matches int,
  window_active_days int,
  baseline_per_active_day numeric,
  resolved_goal int,
  reward_coins int,
  tier_fee int,
  tier_rtp int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_focus text;
  v_fee int;
  v_rtp int;
  v_baseline numeric;
  v_total int;
  v_days int;
  v_target int;
  v_floor int;
  v_cap int;
  c_stretch      numeric := 1.3;
  c_reward_pct   numeric := 0.10;
  c_floor_reward int     := 250;
  c_round        int     := 50;
  c_window       int     := 30;  -- active-day window (days)
begin
  -- focus: most-played ranked-difficulty tier in the window (ties → most recent)
  select coalesce(table_config_id, mode) into v_focus
  from public.matches
  where owner_id = p_profile_id
    and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval
    and coalesce(table_config_id, '') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc
  limit 1;
  v_focus := coalesce(v_focus, 'difficulty-beginner');  -- cold-start default tier

  select entry_fee_coins, target_rtp_pct into v_fee, v_rtp
  from public.table_configs where id = v_focus;
  v_fee := coalesce(v_fee, 1000);
  v_rtp := coalesce(v_rtp, 90);

  -- volume + active days (all finished matches in window)
  select count(*), count(distinct (finished_at at time zone 'UTC')::date)
    into v_total, v_days
  from public.matches
  where owner_id = p_profile_id
    and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval;

  -- baseline = median matches per active day (outlier-resistant)
  select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
  from (
    select count(*)::numeric c
    from public.matches
    where owner_id = p_profile_id
      and finished_at is not null
      and finished_at >= now() - (c_window || ' days')::interval
    group by (finished_at at time zone 'UTC')::date
  ) d;

  v_floor  := greatest(1, ceil(v_baseline * 0.5)::int);
  v_cap    := greatest(v_floor, ceil(v_baseline * 2)::int);
  v_target := greatest(v_floor, least(v_cap, greatest(1, ceil(v_baseline * c_stretch)::int)));

  return query select
    v_focus,
    initcap(replace(replace(v_focus, 'difficulty-', ''), '-', ' ')),
    v_total,
    v_days,
    round(v_baseline, 2),
    v_target,
    greatest(c_floor_reward, (round((c_reward_pct * v_target * v_fee * (1 - v_rtp / 100.0)) / c_round) * c_round)::int),
    v_fee,
    v_rtp;
end;
$$;
revoke execute on function public.mp_play_matches_preview(uuid) from public, anon;
