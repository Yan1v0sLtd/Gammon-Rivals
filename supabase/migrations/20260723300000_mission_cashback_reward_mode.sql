-- Daily Missions — Phase 1 of the tier/cashback work.
--
-- Adds an authorable "cashback" reward mode for fixed/stretch missions: the
-- coin reward is a % of the house edge on the coins the player must wager to
-- clear the mission, rather than a hand-set bundle. Mirrors the formula the
-- personalized engine already uses (reward_pct x goal x fee x (1-RTP)), but
-- exposed per-template and computed at assignment time so the reward auto-scales
-- with the goal and with the pinned difficulty tier.
--
--   investment (coins wagered):
--     - play / streak / match missions: resolved_goal x entry_fee(pinned tier)
--     - wager_coins missions:            resolved_goal   (goal IS the coins)
--   house edge fraction: (1 - target_rtp_pct/100)  [pinned tier, default 90]
--   reward_coins = round(cashback_pct x investment x edge / 50) * 50
--
-- The tier is pinned via params.difficulty_id (e.g. {"difficulty_id":"advanced"}),
-- the same field that drives {tier} display + match/streak tier enforcement. If a
-- non-wager cashback mission has no tier pinned, the reward can't be sized and we
-- leave reward_coins NULL (falls back to the manual bundle); the BO warns.

alter table public.mission_templates
  add column if not exists reward_mode text not null default 'manual',
  add column if not exists cashback_pct numeric;

alter table public.mission_templates
  drop constraint if exists mission_templates_reward_mode_check;
alter table public.mission_templates
  add constraint mission_templates_reward_mode_check
  check (reward_mode in ('manual', 'cashback'));

-- Sizes a cashback coin reward for a template + resolved goal. Returns NULL when
-- the template isn't cashback-mode, or when it can't be sized (non-wager mission
-- with no tier pinned) -- caller then falls back to the manual reward bundle.
create or replace function public.mp_cashback_reward(t public.mission_templates, p_goal int)
returns int language plpgsql stable as $$
declare
  v_fee int;
  v_rtp int;
  v_edge numeric;
  v_investment numeric;
begin
  if t.reward_mode <> 'cashback' or coalesce(t.cashback_pct, 0) <= 0 or coalesce(p_goal, 0) <= 0 then
    return null;
  end if;

  select tc.entry_fee_coins, tc.target_rtp_pct into v_fee, v_rtp
  from public.table_configs tc
  where tc.id = 'difficulty-' || nullif(t.params->>'difficulty_id', '');
  v_edge := 1 - coalesce(v_rtp, 90) / 100.0;

  if t.metric_code = 'coins_wagered_per_day' then
    -- The goal IS the coins wagered; no tier needed for the investment amount.
    v_investment := p_goal;
  elsif v_fee is not null then
    -- Play/streak/match mission: investment = goal games x the tier entry fee.
    v_investment := p_goal::numeric * v_fee;
  else
    return null; -- non-wager cashback with no tier pinned: can't size it
  end if;

  return greatest(0, (round((t.cashback_pct * v_investment * v_edge) / 50.0) * 50)::int);
end;
$$;

-- Recompute the daily/weekly assigner to size cashback rewards at assignment.
-- Reproduced from the live definition (the personalized-guard version) with a
-- v_reward_coins computation (via mp_cashback_reward) added before each insert.
create or replace function public.assign_daily_missions_for_profile(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  prof public.profiles;
  template_row public.mission_templates;
  baseline numeric;
  v_resolved_goal int;
  v_reward_coins int;
  now_utc timestamptz := now();
  day_end timestamptz := (current_date + interval '1 day')::timestamptz;
  week_end timestamptz := (date_trunc('week', current_date) + interval '7 days')::timestamptz;
  is_monday_utc boolean := extract(isodow from current_date) = 1;
  slot_rarities text[] := array['common', 'common', 'rare', 'epic'];
  picked_ids uuid[] := array[]::uuid[];
  picked_types text[] := array[]::text[];
  i int;
  assigned int := 0;
  v_ptype text;
begin
  select * into prof from public.profiles
  where id = p_profile_id and not coalesce(is_suspended, false) and not coalesce(is_guest, false);
  if not found then return 0; end if;

  for v_ptype in
    select mission_type from public.mission_type_config
    where supports_personalized and rollout_pct > 0
      and (abs(hashtextextended(p_profile_id::text || ':' || mission_type, 0)) % 100) < rollout_pct
    order by mission_type
  loop
    if not exists (
      select 1 from public.player_daily_missions pdm
      join public.mission_templates mt on mt.id = pdm.mission_template_id
      where pdm.profile_id = p_profile_id and mt.mission_type = v_ptype
        and mt.resolution_mode = 'personalized' and pdm.expires_at > now_utc
    ) then
      perform public.mp_assign_personalized(p_profile_id, v_ptype);
      assigned := assigned + 1;
    end if;
  end loop;

  select
    coalesce(array_agg(pdm.mission_template_id), '{}'::uuid[]),
    coalesce(array_agg(mt.mission_type), '{}'::text[])
  into picked_ids, picked_types
  from public.player_daily_missions pdm
  join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id and pdm.period = 'daily' and pdm.expires_at > now_utc;

  for i in 1..array_length(slot_rarities, 1) loop
    if (
      select count(*) from public.player_daily_missions pdm
      where pdm.profile_id = p_profile_id and pdm.rarity_slot = slot_rarities[i]
        and pdm.period = 'daily' and pdm.expires_at > now_utc
    ) >= (case slot_rarities[i] when 'common' then 2 when 'rare' then 1 when 'epic' then 1 end)
    then continue; end if;

    select t.* into template_row
    from public.mission_templates t
    where t.enabled = true and t.period = 'daily' and t.rarity = slot_rarities[i]
      and t.resolution_mode <> 'personalized'
      and (t.eligibility->>'min_level' is null or (t.eligibility->>'min_level')::int <= prof.level)
      and (t.eligibility->>'max_level' is null or (t.eligibility->>'max_level')::int >= prof.level)
      and (
        not (t.eligibility ? 'requires_rated' and (t.eligibility->>'requires_rated')::boolean)
        or coalesce(prof.pvp_rating, 0) > 0
      )
      and t.id <> all(picked_ids)
    order by
      (t.mission_type = any(picked_types))::int asc,
      (exists (
        select 1 from public.player_daily_missions pdm
        where pdm.profile_id = p_profile_id
          and pdm.mission_template_id = t.id
          and pdm.assigned_at > now_utc - interval '3 days'
      ))::int asc,
      random()
    limit 1;

    if template_row.id is null then continue; end if;

    if template_row.resolution_mode = 'fixed' then
      v_resolved_goal := template_row.goal_value;
    else
      select pm.baseline_7d into baseline
      from public.player_metrics pm
      where pm.profile_id = p_profile_id and pm.metric_code = template_row.metric_code;
      baseline := coalesce(baseline, 0);
      v_resolved_goal := greatest(template_row.goal_min,
        least(template_row.goal_max, greatest(1, ceil(baseline * template_row.stretch_factor)::int)));
    end if;

    v_reward_coins := public.mp_cashback_reward(template_row, v_resolved_goal);

    insert into public.player_daily_missions
      (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at, reward_coins)
    values
      (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, day_end, 'daily', now_utc, v_reward_coins);

    picked_ids := picked_ids || template_row.id;
    picked_types := picked_types || template_row.mission_type;
    assigned := assigned + 1;
  end loop;

  if is_monday_utc then
    if not exists (
      select 1 from public.player_daily_missions pdm
      where pdm.profile_id = p_profile_id and pdm.period = 'weekly' and pdm.expires_at > now_utc
    ) then
      select t.* into template_row
      from public.mission_templates t
      where t.enabled = true and t.period = 'weekly'
        and t.resolution_mode <> 'personalized'
        and (t.eligibility->>'min_level' is null or (t.eligibility->>'min_level')::int <= prof.level)
        and (t.eligibility->>'max_level' is null or (t.eligibility->>'max_level')::int >= prof.level)
        and (
          not (t.eligibility ? 'requires_rated' and (t.eligibility->>'requires_rated')::boolean)
          or coalesce(prof.pvp_rating, 0) > 0
        )
      order by random() limit 1;
      if template_row.id is not null then
        if template_row.resolution_mode = 'fixed' then
          v_resolved_goal := template_row.goal_value;
        else
          select pm.baseline_7d into baseline
          from public.player_metrics pm
          where pm.profile_id = p_profile_id and pm.metric_code = template_row.metric_code;
          baseline := coalesce(baseline, 0);
          v_resolved_goal := greatest(template_row.goal_min,
            least(template_row.goal_max, greatest(1, ceil(baseline * template_row.stretch_factor)::int)));
        end if;
        v_reward_coins := public.mp_cashback_reward(template_row, v_resolved_goal);
        insert into public.player_daily_missions
          (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at, reward_coins)
        values
          (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, week_end, 'weekly', now_utc, v_reward_coins);
        assigned := assigned + 1;
      end if;
    end if;
  end if;

  return assigned;
end;
$function$;
