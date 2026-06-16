-- Rollout wiring: the nightly assignment cron now pre-assigns personalized
-- missions for rolled-in players (per-type rollout_pct hash gate), occupying a
-- common slot before the generic loop tops up the rest — keeping the 2C/1R/1E
-- shape. Ships fully dark: every type's rollout_pct defaults to 0, so the slate
-- is identical to today for every player until an operator ramps a type in the BO.

alter table public.mission_type_config
  add column if not exists rollout_pct int not null default 0;
alter table public.mission_type_config
  drop constraint if exists mtc_rollout_pct_ck;
alter table public.mission_type_config
  add constraint mtc_rollout_pct_ck check (rollout_pct between 0 and 100);

create or replace function public.assign_daily_missions_for_profile(p_profile_id uuid)
returns integer language plpgsql security definer set search_path to 'public','pg_temp'
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

    select t.* into template_row
    from public.mission_templates t
    where t.enabled = true and t.period = 'daily' and t.rarity = slot_rarities[i]
      and (t.eligibility->>'min_level' is null or (t.eligibility->>'min_level')::int <= prof.level)
      and (t.eligibility->>'max_level' is null or (t.eligibility->>'max_level')::int >= prof.level)
      and (
        not (t.eligibility ? 'requires_rated' and (t.eligibility->>'requires_rated')::boolean)
        or coalesce(prof.pvp_rating, 0) > 0
      )
      and not exists (
        select 1 from public.player_daily_missions pdm
        where pdm.profile_id = p_profile_id
          and pdm.mission_template_id = t.id
          and pdm.assigned_at > now_utc - interval '3 days'
      )
      and t.id <> all(picked_ids)
      and t.mission_type <> all(picked_types)
    order by random() limit 1;

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
