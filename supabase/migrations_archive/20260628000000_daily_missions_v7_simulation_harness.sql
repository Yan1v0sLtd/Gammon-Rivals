-- Daily Missions Phase 8 — simulation harness.
--
-- Adds the BO Simulator surface so the operator can validate the
-- missions system without waiting for real-player traffic. All
-- RPCs are SECURITY DEFINER + gated by private.can_manage_config
-- (owner/admin) inside the function body; granted to authenticated
-- so the BO can call them, but non-admin auth users hit forbidden.

alter table public.profiles add column if not exists is_simulated boolean not null default false;
create index if not exists profiles_is_simulated_idx
  on public.profiles (is_simulated) where is_simulated = true;

-- Note: profiles.id has a FK to auth.users.id, and Supabase has an
-- on_auth_user_created trigger that auto-creates a default profiles
-- row. So we INSERT into auth.users (which is allowed under
-- SECURITY DEFINER as postgres), let the trigger create the
-- profiles row, then UPDATE it with our synthetic fields. We can't
-- use pgcrypto's crypt() inline because it's in the extensions
-- schema and not on the function's search_path; the placeholder
-- hash is fine because these synthetic users never sign in.
create or replace function public.simulate_create_test_profile(
  p_display_name text, p_level int default 1, p_pvp_rating int default 0
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare new_id uuid := gen_random_uuid();
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user
  )
  values (
    new_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sim+' || new_id::text || '@gammon-rivals.test',
    '$2a$10$INVALID-SYNTHETIC-NO-LOGIN-PLACEHOLDER-HASH-AAA',
    now(), now(),
    '{"provider":"simulated","providers":["simulated"]}'::jsonb,
    jsonb_build_object('display_name', '[sim] ' || p_display_name),
    false
  );

  -- The on_auth_user_created trigger created a default profiles row;
  -- patch it with our synthetic fields.
  update public.profiles set
    display_name = '[sim] ' || p_display_name,
    is_guest = false, level = p_level, xp = 0,
    pvp_rating = p_pvp_rating, is_simulated = true,
    avatar_seed = 'sim-' || new_id::text, updated_at = now()
  where id = new_id;

  insert into public.user_wallets (profile_id, coins, gems)
  values (new_id, 5000, 100)
  on conflict (profile_id) do update set coins = 5000, gems = 100;

  return new_id;
end;
$$;
grant execute on function public.simulate_create_test_profile(text, int, int) to authenticated;

create or replace function public.simulate_set_metric(
  p_profile_id uuid, p_metric_code text, p_baseline numeric
)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare new_tier text;
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  values (p_profile_id, p_metric_code, 0, p_baseline)
  on conflict (profile_id, metric_code) do update set
    baseline_7d = excluded.baseline_7d, updated_at = now();
  new_tier := case
    when p_baseline <= 0 then 'casual'
    when p_baseline >= coalesce(
      (select value from public.metric_distributions where metric_code = p_metric_code and percentile = 66), 99999999
    ) then 'whale'
    when p_baseline >= coalesce(
      (select value from public.metric_distributions where metric_code = p_metric_code and percentile = 33), 0
    ) then 'regular'
    else 'casual'
  end;
  insert into public.player_metric_tiers (profile_id, metric_code, tier)
  values (p_profile_id, p_metric_code, new_tier)
  on conflict (profile_id, metric_code) do update set tier = excluded.tier, updated_at = now();
  return new_tier;
end;
$$;
grant execute on function public.simulate_set_metric(uuid, text, numeric) to authenticated;

create or replace function public.simulate_reset_today_missions(p_profile_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare cnt int;
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;
  with deleted as (delete from public.player_daily_missions where profile_id = p_profile_id returning 1)
  select count(*) into cnt from deleted;
  return cnt;
end;
$$;
grant execute on function public.simulate_reset_today_missions(uuid) to authenticated;

create or replace function public.simulate_spawn_archetypes(
  p_casuals int default 5, p_regulars int default 5, p_whales int default 3
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare new_id uuid; i int;
  result jsonb := jsonb_build_object('casuals', 0, 'regulars', 0, 'whales', 0);
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;

  for i in 1..p_casuals loop
    new_id := public.simulate_create_test_profile('casual ' || i, 5, 0);
    perform public.simulate_set_metric(new_id, 'matches_per_day', 1.0);
    perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 50);
    perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 20);
    perform public.simulate_set_metric(new_id, 'xp_per_day', 15);
    perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 0);
    perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 0.5);
    perform public.assign_daily_missions_for_profile(new_id);
  end loop;
  result := jsonb_set(result, '{casuals}', to_jsonb(p_casuals));

  for i in 1..p_regulars loop
    new_id := public.simulate_create_test_profile('regular ' || i, 15, 1200);
    perform public.simulate_set_metric(new_id, 'matches_per_day', 5.0);
    perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 500);
    perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 200);
    perform public.simulate_set_metric(new_id, 'xp_per_day', 75);
    perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 15);
    perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 2.0);
    perform public.simulate_set_metric(new_id, 'ranked_wins_per_week', 4);
    perform public.assign_daily_missions_for_profile(new_id);
  end loop;
  result := jsonb_set(result, '{regulars}', to_jsonb(p_regulars));

  for i in 1..p_whales loop
    new_id := public.simulate_create_test_profile('whale ' || i, 35, 1800);
    perform public.simulate_set_metric(new_id, 'matches_per_day', 15.0);
    perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 5000);
    perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 2000);
    perform public.simulate_set_metric(new_id, 'xp_per_day', 400);
    perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 80);
    perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 5.0);
    perform public.simulate_set_metric(new_id, 'ranked_wins_per_week', 18);
    perform public.assign_daily_missions_for_profile(new_id);
  end loop;
  result := jsonb_set(result, '{whales}', to_jsonb(p_whales));

  perform public.recompute_daily_mission_metrics();
  return result;
end;
$$;
grant execute on function public.simulate_spawn_archetypes(int, int, int) to authenticated;

-- Cleanup nukes both profiles and the auth.users rows we created.
-- Profiles deletes first (cascades to player_metrics, mission state,
-- weekly pass, etc. via on-delete-cascade FKs), then auth.users.
create or replace function public.simulate_cleanup_all()
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare victim_ids uuid[];
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;
  select array_agg(id) into victim_ids from public.profiles where is_simulated = true;
  if victim_ids is null then return 0; end if;
  delete from public.profiles where id = any(victim_ids);
  delete from auth.users   where id = any(victim_ids);
  return array_length(victim_ids, 1);
end;
$$;
grant execute on function public.simulate_cleanup_all() to authenticated;

create or replace function public.simulate_get_test_user_state(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;
  result := jsonb_build_object(
    'profile', (
      select jsonb_build_object('id', id, 'display_name', display_name, 'level', level, 'xp', xp, 'pvp_rating', pvp_rating)
      from public.profiles where id = p_profile_id
    ),
    'metrics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'metric_code', pm.metric_code, 'baseline_7d', pm.baseline_7d, 'tier', t.tier
      ) order by pm.metric_code), '[]'::jsonb)
      from public.player_metrics pm
      left join public.player_metric_tiers t on t.profile_id = pm.profile_id and t.metric_code = pm.metric_code
      where pm.profile_id = p_profile_id
    ),
    'missions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pdm.id, 'title', mt.title, 'rarity', pdm.rarity_slot, 'period', pdm.period,
        'mission_type', mt.mission_type, 'metric_code', mt.metric_code,
        'resolution_mode', mt.resolution_mode, 'resolved_goal', pdm.resolved_goal,
        'mission_points', mt.mission_points,
        'rewards', (
          select coalesce(jsonb_agg(jsonb_build_object('currency_code', mr.currency_code, 'amount', mr.amount)
            order by mr.display_order), '[]'::jsonb)
          from public.mission_rewards mr where mr.mission_id = mt.id
        )
      ) order by case pdm.rarity_slot when 'common' then 1 when 'rare' then 2 when 'epic' then 3 else 4 end
      ), '[]'::jsonb)
      from public.player_daily_missions pdm
      join public.mission_templates mt on mt.id = pdm.mission_template_id
      where pdm.profile_id = p_profile_id and pdm.expires_at > now()
    )
  );
  return result;
end;
$$;
grant execute on function public.simulate_get_test_user_state(uuid) to authenticated;

create or replace function public.simulate_list_test_profiles()
returns jsonb language sql security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'display_name', display_name, 'level', level,
    'pvp_rating', pvp_rating, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from public.profiles where is_simulated = true;
$$;
grant execute on function public.simulate_list_test_profiles() to authenticated;
