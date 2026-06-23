-- Fix: a personalized mission ("Wager {goal} coins") resolved to goal = 1.
--
-- Root cause: personalized missions are meant to be assigned ONLY by the
-- rollout-gated generator (mp_assign_personalized), which computes a real
-- baseline-derived goal. wager_coins had rollout_pct = 0 (generator off), so
-- the generic slot-fill loop in assign_daily_missions_for_profile picked the
-- personalized template at random and ran its *fallback* math on it:
--   resolved_goal = baseline_7d * template.stretch_factor
-- But stretch_factor is a 'stretch'-mode field; personalized templates leave it
-- NULL, so `baseline * NULL = NULL` and the expression floors to 1 → "Wager 1
-- coins".
--
-- Two changes:
--   1. Harden assign_daily_missions_for_profile: the generic daily + weekly
--      slot-fill never picks resolution_mode='personalized' templates. Those
--      belong to the rollout-gated generator only. (Prevents the whole class of
--      "personalized template collapses to floor" bug for any type.)
--   2. Turn the wager_coins personalized generator ON (rollout_pct 0 → 100) so
--      it actually runs and produces baseline-derived goals.
--
-- Reproduced from the live assign_daily_missions_for_profile definition with two
-- added `and t.resolution_mode <> 'personalized'` guards (daily pick + weekly
-- pick); nothing else changed.

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
      -- Personalized templates are assigned only by the rollout-gated generator
      -- above; never via this generic fill (it would run stretch math on them
      -- and collapse the goal to the floor).
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

-- Turn the wager_coins personalized generator ON.
update public.mission_type_config
  set rollout_pct = 100, updated_at = now()
  where mission_type = 'wager_coins';
