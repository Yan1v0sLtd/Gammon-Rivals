-- Daily missions: guarantee every rarity slot fills (don't drop the epic).
--
-- assign_daily_missions_for_profile fills slots ['common','common','rare','epic'].
-- The per-slot template pick used "distinct mission_type from those already
-- picked this run" AND "not assigned to this player in the last 3 days" as HARD
-- filters. The epic slot is filled last, after common+common+rare have already
-- claimed 3 mission_types — so when every remaining-eligible epic template either
-- shares one of those types or was seen in the last 3 days, the epic pick returns
-- nothing and the slot is silently skipped → the player gets 3 missions, not 4.
-- With only ~6 epic types (several overlapping the common/rare pool) this happens
-- often.
--
-- Fix: keep ELIGIBILITY (min/max level, requires_rated) and "no duplicate
-- template id" as HARD constraints, but demote "distinct mission_type" and
-- "not seen in 3 days" to ORDER BY preferences. The slot now always fills if the
-- player is eligible for ANY template of that rarity; a same-type or
-- recently-seen pick is used only as a last resort. Same change keeps the
-- common/rare slots from ever coming up short too.

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

  -- Personalized rollout: for each personalized type the player hashes into
  -- (rollout_pct gate), pre-assign it so it occupies a common slot before the
  -- generic loop tops up the rest. mp_assign_personalized has its own dup-guard.
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

  for i in 1..array_length(slot_rarities, 1) loop
    if (
      select count(*) from public.player_daily_missions pdm
      where pdm.profile_id = p_profile_id and pdm.rarity_slot = slot_rarities[i]
        and pdm.period = 'daily' and pdm.expires_at > now_utc
    ) >= (case slot_rarities[i] when 'common' then 2 when 'rare' then 1 when 'epic' then 1 end)
    then continue; end if;

    -- Eligibility + "no duplicate template this run" are HARD. "Distinct
    -- mission_type" and "not assigned in the last 3 days" are PREFERENCES in
    -- ORDER BY, so the slot always fills when the player is eligible for any
    -- template of this rarity (the epic slot stops getting dropped).
    select t.* into template_row
    from public.mission_templates t
    where t.enabled = true and t.period = 'daily' and t.rarity = slot_rarities[i]
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

    insert into public.player_daily_missions
      (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at)
    values
      (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, day_end, 'daily', now_utc);

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
        insert into public.player_daily_missions
          (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at)
        values
          (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, week_end, 'weekly', now_utc);
        assigned := assigned + 1;
      end if;
    end if;
  end if;

  return assigned;
end;
$function$;
