-- Mission type registry + per-type tunable config.
-- Makes the personalized-controller coefficients DATA (BO-editable) instead of
-- literals baked into mp_assign_*, and gives the BO a typed list of mission
-- types + their metric binding + a wired/not-wired truth flag.
-- See docs/daily-missions-redesign.md §G.

create table if not exists public.mission_type_config (
  mission_type           text primary key,
  metric_code            text not null,
  label                  text not null,
  description            text,
  is_wired               boolean not null default true,
  supports_personalized  boolean not null default false,
  -- adaptive controller coefficients (used when a personalized template of this type is assigned)
  base_stretch           numeric not null default 1.3,
  up_step                int     not null default 1,
  ease_after             int     not null default 2,
  ease_factor            numeric not null default 0.75,
  floor_mult             numeric not null default 0.5,
  cap_mult               numeric not null default 2.0,
  reward_pct             numeric not null default 0.10,
  floor_reward           int     not null default 250,
  round_to               int     not null default 50,
  baseline_window_days   int     not null default 30,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- reward_pct < 1 keeps the self-funding economy invariant (RTP + b·(1−RTP) < 100%) safe by construction
  constraint mtc_reward_pct_ck    check (reward_pct >= 0 and reward_pct < 1),
  constraint mtc_floor_mult_ck    check (floor_mult > 0 and floor_mult <= 1),
  constraint mtc_cap_mult_ck      check (cap_mult >= 1),
  constraint mtc_round_ck         check (round_to >= 1),
  constraint mtc_ease_after_ck    check (ease_after >= 1),
  constraint mtc_up_step_ck       check (up_step >= 0),
  constraint mtc_window_ck        check (baseline_window_days >= 1),
  constraint mtc_base_stretch_ck  check (base_stretch >= 1),
  constraint mtc_floor_reward_ck  check (floor_reward >= 0)
);

comment on table public.mission_type_config is
  'Per-mission-type registry + tunable config. metric_code binds the type to its progress event; is_wired flags whether that event is actually emitted; coefficient columns drive the personalized adaptive controller (docs/daily-missions-redesign.md §G). Coefficients are DATA, edited in the BO, read by mp_assign_*.';

alter table public.mission_type_config enable row level security;

drop policy if exists mission_type_config_read on public.mission_type_config;
create policy mission_type_config_read on public.mission_type_config
  for select to authenticated using (true);

drop policy if exists mission_type_config_write on public.mission_type_config;
create policy mission_type_config_write on public.mission_type_config
  for all to authenticated
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop trigger if exists mission_type_config_updated_at on public.mission_type_config;
create trigger mission_type_config_updated_at
  before update on public.mission_type_config
  for each row execute function public.set_updated_at();

-- Seed every mission type currently in mission_templates, with its metric binding
-- and the empirical wiring truth (only rating_diff_won is dead).
insert into public.mission_type_config
  (mission_type, metric_code, label, description, is_wired, supports_personalized)
values
  ('play_matches','matches_per_day','Play matches','Play a number of matches at the player''s most-played difficulty tier. Personalized: goal + reward generated per player.',true,true),
  ('play_difficulty','matches_per_day','Play at a difficulty','Play matches at a specific difficulty tier (tier set via params).',true,false),
  ('win_streak','win_streak','Win streak','Win several matches in a row (resets on a loss).',true,false),
  ('wager_coins','coins_wagered_per_day','Wager coins','Wager a total amount of coins across matches in a day.',true,false),
  ('win_coins_net','coins_won_net_per_day','Net coins won','Finish the day up by a net amount of coins.',true,false),
  ('earn_xp','xp_per_day','Earn XP','Earn a total amount of XP in a day.',true,false),
  ('spend_gems','gems_spent_per_day','Spend gems','Spend a total amount of gems in a day.',true,false),
  ('spin_wheel','wheel_spins_per_day','Spin the wheel','Spin the hourly wheel a number of times.',true,false),
  ('level_up','levels_per_week','Level up','Gain one or more account levels.',true,false),
  ('weekly_ranked_wins','ranked_wins_per_week','Ranked wins (weekly)','Win ranked online matches this week. Wired, but no qualifying matches recorded yet.',true,false),
  ('meta_complete_missions','missions_claimed_per_day','Complete missions','Claim a number of other missions in a day (meta-mission).',true,false),
  ('beat_higher_rated','rating_diff_won','Punching up','Beat an opponent rated higher than you. NOT WIRED: rating_diff_won is never emitted by any event hook — needs wiring or retirement.',false,false)
on conflict (mission_type) do nothing;

-- Refactor the generator to read coefficients from mission_type_config.
-- Behavior is identical to 20260614130000 when the seed equals the old literals
-- (it does); literals remain as fallbacks if the config row is ever missing.
create or replace function public.mp_assign_play_matches(p_profile_id uuid)
returns public.player_daily_missions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_cfg public.mission_type_config;
  c_stretch numeric; c_up int; c_ease_after int; c_ease numeric;
  c_floor_mult numeric; c_cap_mult numeric;
  c_reward_pct numeric; c_floor_reward int; c_round int; c_window int;
  v_focus text; v_fee int; v_rtp int; v_baseline numeric;
  v_floor int; v_cap int;
  v_target int; v_last_completed int; v_misses int; v_has_ctrl boolean;
  v_active public.player_daily_missions;
  v_prior public.player_daily_missions;
  v_template public.mission_templates;
  v_reward int; v_day_end timestamptz; v_row public.player_daily_missions;
begin
  select * into v_cfg from public.mission_type_config where mission_type = 'play_matches';
  c_stretch      := coalesce(v_cfg.base_stretch, 1.3);
  c_up           := coalesce(v_cfg.up_step, 1);
  c_ease_after   := coalesce(v_cfg.ease_after, 2);
  c_ease         := coalesce(v_cfg.ease_factor, 0.75);
  c_floor_mult   := coalesce(v_cfg.floor_mult, 0.5);
  c_cap_mult     := coalesce(v_cfg.cap_mult, 2.0);
  c_reward_pct   := coalesce(v_cfg.reward_pct, 0.10);
  c_floor_reward := coalesce(v_cfg.floor_reward, 250);
  c_round        := coalesce(v_cfg.round_to, 50);
  c_window       := coalesce(v_cfg.baseline_window_days, 30);

  select pdm.* into v_active
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = 'play_matches' and mt.resolution_mode = 'personalized'
    and pdm.completed_at is null and pdm.expires_at > now()
  order by pdm.assigned_at desc limit 1;
  if v_active.id is not null then return v_active; end if;

  select coalesce(table_config_id, mode) into v_focus
  from public.matches
  where owner_id = p_profile_id and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval
    and coalesce(table_config_id, '') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc limit 1;
  v_focus := coalesce(v_focus, 'difficulty-beginner');

  select entry_fee_coins, target_rtp_pct into v_fee, v_rtp
  from public.table_configs where id = v_focus;
  v_fee := coalesce(v_fee, 1000); v_rtp := coalesce(v_rtp, 90);

  select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
  from (
    select count(*)::numeric c from public.matches
    where owner_id = p_profile_id and finished_at is not null
      and finished_at >= now() - (c_window || ' days')::interval
    group by (finished_at at time zone 'UTC')::date
  ) d;
  v_floor := greatest(1, ceil(v_baseline * c_floor_mult)::int);
  v_cap   := greatest(v_floor, ceil(v_baseline * c_cap_mult)::int);

  select true, target, last_completed_target, consecutive_misses
    into v_has_ctrl, v_target, v_last_completed, v_misses
  from public.player_mission_difficulty
  where profile_id = p_profile_id and mission_type = 'play_matches';

  select pdm.* into v_prior
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = 'play_matches' and mt.resolution_mode = 'personalized'
    and (pdm.completed_at is not null or pdm.expires_at <= now())
  order by pdm.assigned_at desc limit 1;

  if v_has_ctrl is null then
    v_target := greatest(v_floor, least(v_cap, greatest(1, ceil(v_baseline * c_stretch)::int)));
    v_last_completed := null; v_misses := 0;
  elsif v_prior.id is not null and v_prior.completed_at is not null then
    v_last_completed := v_prior.resolved_goal;
    v_target := least(v_cap, v_prior.resolved_goal + c_up);
    v_misses := 0;
  elsif v_prior.id is not null and v_prior.expires_at <= now() then
    v_misses := coalesce(v_misses, 0) + 1;
    if v_misses >= c_ease_after then
      v_target := greatest(v_floor, ceil(coalesce(v_last_completed, v_prior.resolved_goal) * c_ease)::int);
      v_misses := 0;
    else
      v_target := v_prior.resolved_goal;
    end if;
  end if;
  v_target := greatest(v_floor, least(v_cap, greatest(1, coalesce(v_target, 1))));

  insert into public.player_mission_difficulty
    (profile_id, mission_type, target, last_completed_target, consecutive_misses, updated_at)
  values (p_profile_id, 'play_matches', v_target, v_last_completed, v_misses, now())
  on conflict (profile_id, mission_type) do update
    set target = excluded.target, last_completed_target = excluded.last_completed_target,
        consecutive_misses = excluded.consecutive_misses, updated_at = now();

  v_reward := greatest(c_floor_reward,
    (round((c_reward_pct * v_target * v_fee * (1 - v_rtp / 100.0)) / c_round) * c_round)::int);

  select * into v_template from public.mission_templates
    where mission_type = 'play_matches' and resolution_mode = 'personalized' limit 1;

  v_day_end := (date_trunc('day', (now() at time zone 'UTC')) + interval '1 day') at time zone 'UTC';

  insert into public.player_daily_missions
    (profile_id, mission_template_id, rarity_slot, resolved_goal, progress,
     expires_at, assigned_at, period, focus_tier, reward_coins)
  values
    (p_profile_id, v_template.id, 'common', v_target, 0,
     v_day_end, now(), 'daily', v_focus, v_reward)
  returning * into v_row;

  return v_row;
end;
$$;
revoke execute on function public.mp_assign_play_matches(uuid) from public, anon;
