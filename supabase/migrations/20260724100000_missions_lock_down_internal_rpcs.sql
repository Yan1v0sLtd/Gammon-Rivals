-- Security fix — lock down the Daily Missions internal RPC surface.
--
-- CONFIRMED exploit (2026-07-02 audit): public.progress_mission /
-- progress_mission_reset are SECURITY DEFINER but were EXECUTE-granted to
-- PUBLIC/anon/authenticated and reachable at /rest/v1/rpc/progress_mission. They
-- take a caller-supplied profile_id + delta with NO ownership check, so any
-- logged-in (or anonymous) session could complete its own missions for free and
-- then claim the reward — a coin/gem mint. Proved in a rolled-back tx: one call
-- drove a real mission from progress 0 -> goal + set completed_at.
--
-- These helpers are only ever invoked internally: progress_mission by the
-- mission triggers (matches/profiles xp/level/wallet_transactions), by
-- claim_mission, and by spin_wheel; progress_mission_reset by the match trigger.
-- The mp_assign_* helpers are only invoked by assign_daily_missions_for_profile.
-- All of those callers are SECURITY DEFINER functions owned by postgres, so they
-- keep working after we revoke the client-facing grants (the EXECUTE check runs
-- against the definer/owner, and trigger firing never checks EXECUTE).
--
-- No client code calls any of these directly (grep-verified). The one exception
-- is assign_daily_missions_for_profile, which the back-office mission tool calls
-- by id — so instead of revoking it we add an owner-or-admin guard (the nightly
-- cron runs with auth.uid() = null and is unaffected).

-- 1. Owner-or-admin guard on the assigner ------------------------------------
-- Reproduced verbatim from 20260723300000 (the live definition) with a single
-- guard block added right after `begin`.
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
  -- Only the owner (self-service) or a config manager may assign missions for a
  -- profile. The cron (assign_daily_missions_for_all) runs with auth.uid() = null
  -- and is therefore unaffected; a PostgREST caller must pass their own id or be
  -- an admin, closing the "assign onto arbitrary accounts" surface.
  if auth.uid() is not null
     and p_profile_id <> auth.uid()
     and not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;

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

-- 2. Revoke the client-facing EXECUTE on the internal helpers -----------------
-- Progress writers (the actual mint vector).
revoke execute on function public.progress_mission(uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.progress_mission_reset(uuid, text) from public, anon, authenticated;

-- Assignment helpers — only invoked internally by assign_daily_missions_for_profile.
revoke execute on function public.mp_assign_personalized(uuid, text) from public, anon, authenticated;
revoke execute on function public.mp_assign_play_matches(uuid) from public, anon, authenticated;
revoke execute on function public.mp_play_matches_preview(uuid) from public, anon, authenticated;

-- Trigger functions — auto-exposed as RPCs; only meaningful inside a trigger.
revoke execute on function public.matches_progress_missions() from public, anon, authenticated;
revoke execute on function public.profiles_progress_xp_missions() from public, anon, authenticated;
revoke execute on function public.profiles_progress_level_missions() from public, anon, authenticated;
revoke execute on function public.wallet_transactions_progress_missions() from public, anon, authenticated;
revoke execute on function public.enforce_personalized_mission_fields() from public, anon, authenticated;
