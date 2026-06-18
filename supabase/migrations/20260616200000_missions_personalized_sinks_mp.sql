-- Sink mission types (spend_gems, spin_wheel, meta_complete_missions) as
-- personalized missions that reward MISSION POINTS, not coins. These have no coin
-- loss to self-fund from, so a coin reward would be a pure faucet; instead the
-- generator sets reward_coins = null for them → claim grants only the template's
-- mission_points (the existing fallback path), no coins. Goals still personalize
-- to each player's gem-spend / wheel-spin / mission-claim habit. Ships DARK
-- (templates disabled, rollout_pct 0).

update public.mission_type_config set supports_personalized=true, base_stretch=1.3, floor_mult=0.5, cap_mult=2.0, up_step=5, goal_round_to=5 where mission_type='spend_gems';
update public.mission_type_config set supports_personalized=true, base_stretch=1.3, floor_mult=0.5, cap_mult=2.0, up_step=1, goal_round_to=1 where mission_type='spin_wheel';
update public.mission_type_config set supports_personalized=true, base_stretch=1.3, floor_mult=0.5, cap_mult=2.0, up_step=1, goal_round_to=1 where mission_type='meta_complete_missions';

insert into public.mission_templates (mission_type, metric_code, rarity, resolution_mode, period, title, subtitle, mission_points, enabled)
select v.mt, v.mc, 'common', 'personalized', 'daily', v.t, v.s, 15, false
from (values
  ('spend_gems','gems_spent_per_day','Spend {goal} gems','Put your gems to work.'),
  ('spin_wheel','wheel_spins_per_day','Spin {goal} times','Give the wheel a whirl.'),
  ('meta_complete_missions','missions_claimed_per_day','Complete {goal} missions','Clear your dailies.')
) v(mt,mc,t,s)
where not exists (select 1 from public.mission_templates m where m.mission_type=v.mt and m.resolution_mode='personalized');

create or replace function public.mp_assign_personalized(p_profile_id uuid, p_mission_type text)
returns public.player_daily_missions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cfg public.mission_type_config;
  v_focus_tier text; v_repr_tier text; v_fee int; v_rtp int;
  v_baseline numeric; v_loss_unit numeric; v_reward_is_mp boolean := false;
  v_round int; v_floor int; v_cap int;
  v_target int; v_last_completed int; v_misses int; v_has_ctrl boolean;
  v_active public.player_daily_missions; v_prior public.player_daily_missions;
  v_template public.mission_templates;
  v_reward int; v_day_end timestamptz; v_row public.player_daily_missions;
begin
  select * into cfg from public.mission_type_config where mission_type = p_mission_type;
  if cfg.mission_type is null or not cfg.supports_personalized then
    raise exception 'mission type % is not personalized-capable', p_mission_type;
  end if;
  v_round := greatest(1, coalesce(cfg.goal_round_to, 1));

  select pdm.* into v_active
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = p_mission_type and mt.resolution_mode = 'personalized'
    and pdm.completed_at is null and pdm.expires_at > now()
  order by pdm.assigned_at desc limit 1;
  if v_active.id is not null then return v_active; end if;

  select coalesce(table_config_id, mode) into v_repr_tier
  from public.matches
  where owner_id = p_profile_id and finished_at is not null
    and finished_at >= now() - (cfg.baseline_window_days || ' days')::interval
    and coalesce(table_config_id,'') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc limit 1;
  v_repr_tier := coalesce(v_repr_tier, 'difficulty-beginner');
  select entry_fee_coins, target_rtp_pct into v_fee, v_rtp from public.table_configs where id = v_repr_tier;
  v_fee := coalesce(v_fee, 1000); v_rtp := coalesce(v_rtp, 90);

  if p_mission_type = 'play_matches' then
    v_focus_tier := v_repr_tier;
    v_loss_unit  := v_fee * (1 - v_rtp/100.0);
    select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
    from (select count(*)::numeric c from public.matches
          where owner_id = p_profile_id and finished_at is not null
            and finished_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (finished_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'wager_coins' then
    v_focus_tier := null;
    v_loss_unit  := (1 - v_rtp/100.0);
    select coalesce(percentile_cont(0.5) within group (order by s), 0) into v_baseline
    from (select sum(abs(amount))::numeric s from public.wallet_transactions
          where profile_id = p_profile_id and source='entry_fee' and currency='coins'
            and created_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'win_streak' then
    v_focus_tier := null;
    v_loss_unit  := v_fee * (1 - v_rtp/100.0);
    select greatest(2, round(coalesce(avg(run_len), 0))::int) into v_baseline
    from (
      select count(*)::numeric as run_len
      from (
        select (m.winner is not null and m.winner = m.owner_color) as won,
               row_number() over (order by m.finished_at)
               - row_number() over (partition by (m.winner is not null and m.winner = m.owner_color) order by m.finished_at) as grp
        from public.matches m
        where m.owner_id = p_profile_id and m.finished_at is not null
          and m.finished_at >= now() - (cfg.baseline_window_days || ' days')::interval
      ) s where s.won group by s.grp
    ) runs;
  elsif p_mission_type = 'spend_gems' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by s), 0) into v_baseline
    from (select sum(abs(amount))::numeric s from public.wallet_transactions
          where profile_id=p_profile_id and currency='gems' and amount<0 and source in ('purchase','mission_reroll_fee')
            and created_at >= now() - (cfg.baseline_window_days||' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'spin_wheel' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
    from (select count(*)::numeric c from public.wallet_transactions
          where profile_id=p_profile_id and source='wheel_spin' and currency='coins'
            and created_at >= now() - (cfg.baseline_window_days||' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'meta_complete_missions' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_baseline
    from (select count(*)::numeric c from public.player_daily_missions
          where profile_id=p_profile_id and claimed_at is not null
            and claimed_at >= now() - (cfg.baseline_window_days||' days')::interval
          group by (claimed_at at time zone 'UTC')::date) d;
  else
    raise exception 'mp_assign_personalized: no generator for %', p_mission_type;
  end if;

  v_floor := greatest(v_round, (ceil(v_baseline * cfg.floor_mult / v_round) * v_round)::int);
  v_cap   := greatest(v_floor, (ceil(v_baseline * cfg.cap_mult / v_round) * v_round)::int);

  select true, target, last_completed_target, consecutive_misses
    into v_has_ctrl, v_target, v_last_completed, v_misses
  from public.player_mission_difficulty
  where profile_id = p_profile_id and mission_type = p_mission_type;

  select pdm.* into v_prior
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = p_mission_type and mt.resolution_mode = 'personalized'
    and (pdm.completed_at is not null or pdm.expires_at <= now())
  order by pdm.assigned_at desc limit 1;

  if v_has_ctrl is null then
    v_target := (ceil(v_baseline * cfg.base_stretch / v_round) * v_round)::int;
    v_last_completed := null; v_misses := 0;
  elsif v_prior.id is not null and v_prior.completed_at is not null then
    v_last_completed := v_prior.resolved_goal;
    v_target := v_prior.resolved_goal + cfg.up_step;
    v_misses := 0;
  elsif v_prior.id is not null and v_prior.expires_at <= now() then
    v_misses := coalesce(v_misses,0) + 1;
    if v_misses >= cfg.ease_after then
      v_target := least(v_prior.resolved_goal - v_round,
        (floor(coalesce(v_last_completed, v_prior.resolved_goal) * cfg.ease_factor / v_round) * v_round)::int);
      v_misses := 0;
    else
      v_target := v_prior.resolved_goal;
    end if;
  end if;
  v_target := greatest(v_floor, least(v_cap, greatest(v_round, coalesce(v_target, v_round))));

  insert into public.player_mission_difficulty
    (profile_id, mission_type, target, last_completed_target, consecutive_misses, updated_at)
  values (p_profile_id, p_mission_type, v_target, v_last_completed, v_misses, now())
  on conflict (profile_id, mission_type) do update
    set target=excluded.target, last_completed_target=excluded.last_completed_target,
        consecutive_misses=excluded.consecutive_misses, updated_at=now();

  v_reward := greatest(cfg.floor_reward,
    (round((cfg.reward_pct * v_target * coalesce(v_loss_unit,0)) / cfg.round_to) * cfg.round_to)::int);

  select * into v_template from public.mission_templates
    where mission_type = p_mission_type and resolution_mode = 'personalized' limit 1;
  if v_template.id is null then raise exception 'no personalized template for %', p_mission_type; end if;

  v_day_end := (date_trunc('day', (now() at time zone 'UTC')) + interval '1 day') at time zone 'UTC';

  insert into public.player_daily_missions
    (profile_id, mission_template_id, rarity_slot, resolved_goal, progress, expires_at, assigned_at, period, focus_tier, reward_coins)
  values (p_profile_id, v_template.id, 'common', v_target, 0, v_day_end, now(), 'daily', v_focus_tier,
          case when v_reward_is_mp then null else v_reward end)
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.mp_assign_personalized(uuid, text) from public, anon;
