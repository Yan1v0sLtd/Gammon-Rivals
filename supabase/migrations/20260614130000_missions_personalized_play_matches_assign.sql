-- Personalized missions — integration step 2a: "Play matches" generator +
-- adaptive controller + assignment. Dark / additive:
--   * new resolution_mode 'personalized' (no existing template uses it),
--   * new nullable columns on player_daily_missions (legacy rows untouched),
--   * a DISABLED personalized template (the nightly cron never picks it),
--   * mp_assign_play_matches() is called manually for test accounts until the
--     cron is wired (a later step). No existing live function is modified here.

-- 1. allow the new resolution mode (both the enum check and the goal-presence
--    check; 'personalized' carries neither goal_value nor stretch_factor — the
--    goal is generated per-player at assignment).
alter table public.mission_templates drop constraint if exists mission_templates_resolution_mode_check;
alter table public.mission_templates add constraint mission_templates_resolution_mode_check
  check (resolution_mode in ('fixed', 'stretch', 'personalized'));

alter table public.mission_templates drop constraint if exists mission_templates_check1;
alter table public.mission_templates add constraint mission_templates_check1
  check (
    (resolution_mode = 'fixed'  and goal_value is not null and stretch_factor is null)
    or (resolution_mode = 'stretch' and stretch_factor is not null)
    or (resolution_mode = 'personalized')
  );

-- 2. per-mission snapshot of the personalized focus tier + reward
alter table public.player_daily_missions
  add column if not exists focus_tier   text,
  add column if not exists reward_coins int;
comment on column public.player_daily_missions.focus_tier is
  'Personalized missions: the table_configs tier this mission counts toward (e.g. difficulty-advanced). NULL for legacy/generic missions.';
comment on column public.player_daily_missions.reward_coins is
  'Personalized missions: coin reward snapshotted at assignment. NULL → fall back to the template reward bundle.';

-- 3. seed the personalized "Play matches" template, DISABLED (dark)
insert into public.mission_templates
  (mission_type, metric_code, rarity, resolution_mode, period, title, subtitle, mission_points, enabled)
select 'play_matches', 'matches_per_day', 'common', 'personalized', 'daily',
       'Play matches', 'Keep the dice rolling.', 10, false
where not exists (
  select 1 from public.mission_templates
  where mission_type = 'play_matches' and resolution_mode = 'personalized'
);

-- 4. generator + adaptive controller + assignment (one profile)
create or replace function public.mp_assign_play_matches(p_profile_id uuid)
returns public.player_daily_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- coefficients (→ per-type BO config later)
  c_stretch      numeric := 1.3;
  c_up           int     := 1;
  c_ease_after   int     := 2;
  c_ease         numeric := 0.75;
  c_reward_pct   numeric := 0.10;
  c_floor_reward int     := 250;
  c_round        int     := 50;
  c_window       int     := 30;
  v_focus text; v_fee int; v_rtp int; v_baseline numeric;
  v_floor int; v_cap int;
  v_target int; v_last_completed int; v_misses int; v_has_ctrl boolean;
  v_active public.player_daily_missions;
  v_prior public.player_daily_missions;
  v_template public.mission_templates;
  v_reward int; v_day_end timestamptz; v_row public.player_daily_missions;
begin
  -- Idempotency: if an active (unexpired, unclaimed-incomplete) personalized
  -- play_matches mission already exists, return it instead of duplicating.
  select pdm.* into v_active
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = 'play_matches' and mt.resolution_mode = 'personalized'
    and pdm.completed_at is null and pdm.expires_at > now()
  order by pdm.assigned_at desc
  limit 1;
  if v_active.id is not null then
    return v_active;
  end if;

  -- focus tier: most-played ranked-difficulty tier in window (recency tiebreak)
  select coalesce(table_config_id, mode) into v_focus
  from public.matches
  where owner_id = p_profile_id and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval
    and coalesce(table_config_id, '') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc
  limit 1;
  v_focus := coalesce(v_focus, 'difficulty-beginner');

  select entry_fee_coins, target_rtp_pct into v_fee, v_rtp
  from public.table_configs where id = v_focus;
  v_fee := coalesce(v_fee, 1000); v_rtp := coalesce(v_rtp, 90);

  -- baseline = median matches per active day
  select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
  from (
    select count(*)::numeric c from public.matches
    where owner_id = p_profile_id and finished_at is not null
      and finished_at >= now() - (c_window || ' days')::interval
    group by (finished_at at time zone 'UTC')::date
  ) d;
  v_floor := greatest(1, ceil(v_baseline * 0.5)::int);
  v_cap   := greatest(v_floor, ceil(v_baseline * 2)::int);

  -- controller state
  select true, target, last_completed_target, consecutive_misses
    into v_has_ctrl, v_target, v_last_completed, v_misses
  from public.player_mission_difficulty
  where profile_id = p_profile_id and mission_type = 'play_matches';

  -- most recent RESOLVED prior instance drives the controller
  select pdm.* into v_prior
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = 'play_matches' and mt.resolution_mode = 'personalized'
    and (pdm.completed_at is not null or pdm.expires_at <= now())
  order by pdm.assigned_at desc
  limit 1;

  if v_has_ctrl is null then
    -- cold start
    v_target := greatest(v_floor, least(v_cap, greatest(1, ceil(v_baseline * c_stretch)::int)));
    v_last_completed := null; v_misses := 0;
  elsif v_prior.id is not null and v_prior.completed_at is not null then
    -- completed → re-stretch from the proven level (slow, +1)
    v_last_completed := v_prior.resolved_goal;
    v_target := least(v_cap, v_prior.resolved_goal + c_up);
    v_misses := 0;
  elsif v_prior.id is not null and v_prior.expires_at <= now() then
    -- missed → forgive once, then ease hard to a clearly-winnable level
    v_misses := coalesce(v_misses, 0) + 1;
    if v_misses >= c_ease_after then
      v_target := greatest(v_floor, ceil(coalesce(v_last_completed, v_prior.resolved_goal) * c_ease)::int);
      v_misses := 0;
    else
      v_target := v_prior.resolved_goal; -- hold (one busy day forgiven)
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
