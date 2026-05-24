-- Daily Missions v5 — chest claim, streak chest, reroll, streak rollover.
--
-- Phase 5 per docs/specs/daily-missions.md.
--
-- Delivers:
--   • streak_chest_rewards    — new table for the 7-day streak chest
--                               bundle (operator-edited, same poly
--                               shape as mission_rewards).
--   • mission_rerolls         — new audit/count log for reroll events.
--                               Counts "how many rerolls today" against
--                               reroll_pricing_config.daily_cap.
--   • claim_chest(idx)        — claim a weekly-pass chest milestone.
--                               Validates mp_earned ≥ threshold,
--                               credits chest_rewards, appends idx to
--                               player_weekly_pass.chests_claimed.
--   • claim_streak_chest()    — claim the 7-day completion chest.
--                               Validates current_streak_days ≥ 7,
--                               credits streak_chest_rewards, decrements
--                               streak by 7 and increments total claims.
--   • reroll_mission(id)      — swap a daily mission for a new one
--                               from the same rarity pool. Charges gems
--                               per ladder. Anti-repeats against today's
--                               other active templates AND mission_types.
--   • daily_streak_rollover() — nightly: zero current_streak_days for
--                               players whose last_complete_date is
--                               older than yesterday.
--   • Cron schedule: daily-streak-rollover at 00:15 UTC.
--
-- (The +10% MP streak bonus is deferred to Phase 7 since it requires
-- BO toggle wiring — schema field player_weekly_pass.streak_bonus_active
-- is already present.)

-- ============================================================
-- Section 1: streak_chest_rewards (singleton bundle for the 7-day chest)
-- ============================================================
create table public.streak_chest_rewards (
  id uuid primary key default gen_random_uuid(),
  reward_kind text not null check (reward_kind in ('currency', 'item')),
  currency_code text references public.currencies(code),
  item_table text,
  item_id text,
  amount int not null default 1 check (amount > 0),
  display_order int not null default 0,
  created_at timestamptz not null default now(),

  check (
    (reward_kind = 'currency' and currency_code is not null and item_table is null and item_id is null) or
    (reward_kind = 'item'     and currency_code is null     and item_table is not null and item_id is not null)
  )
);

alter table public.streak_chest_rewards enable row level security;

create policy streak_chest_rewards_read on public.streak_chest_rewards
  for select using (true);

create policy streak_chest_rewards_admin_write on public.streak_chest_rewards
  for all using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- Seed: a single generous bundle. Operator tunes via BO.
insert into public.streak_chest_rewards (reward_kind, currency_code, amount, display_order) values
  ('currency', 'coins',  5000, 0),
  ('currency', 'gems',   50,   1),
  ('currency', 'xp',     100,  2);

-- ============================================================
-- Section 2: mission_rerolls — audit + count source.
-- ============================================================
create table public.mission_rerolls (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rerolled_at timestamptz not null default now(),
  gem_cost int not null check (gem_cost >= 0),
  prior_template_id uuid references public.mission_templates(id) on delete set null,
  new_template_id uuid references public.mission_templates(id) on delete set null,
  player_daily_mission_id uuid
);

create index mission_rerolls_profile_idx
  on public.mission_rerolls (profile_id, rerolled_at desc);

alter table public.mission_rerolls enable row level security;

create policy mission_rerolls_own_read on public.mission_rerolls
  for select using (profile_id = auth.uid() or private.is_admin(auth.uid()));

-- ============================================================
-- Section 3: claim_chest(milestone_index)
-- ============================================================
create or replace function public.claim_chest(p_milestone_index int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  milestone public.chest_milestones;
  pass_row public.player_weekly_pass;
  reward record;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  total_coins int := 0;
  total_gems int := 0;
  total_xp int := 0;
  week_key text := to_char(now(), 'IYYY-"W"IW');
  already_claimed boolean;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  select * into milestone from public.chest_milestones
  where milestone_index = p_milestone_index and enabled = true;
  if not found then raise exception 'milestone_not_found'; end if;

  -- Lock the weekly-pass row so concurrent claims are serialised.
  select * into pass_row from public.player_weekly_pass
  where profile_id = caller_id and week_key = week_key
  for update;
  if not found then raise exception 'pass_not_started'; end if;

  if pass_row.mp_earned < milestone.threshold_mp then
    raise exception 'threshold_not_met';
  end if;

  -- Already claimed?
  already_claimed := exists (
    select 1 from jsonb_array_elements_text(pass_row.chests_claimed) e
    where e::int = p_milestone_index
  );
  if already_claimed then raise exception 'already_claimed'; end if;

  -- Credit the chest bundle.
  insert into public.user_wallets (profile_id) values (caller_id)
  on conflict (profile_id) do nothing;

  for reward in
    select reward_kind, currency_code, item_table, item_id, amount
    from public.chest_rewards where milestone_id = milestone.id order by display_order
  loop
    if reward.reward_kind = 'currency' then
      case reward.currency_code
        when 'coins' then total_coins := total_coins + reward.amount;
        when 'gems'  then total_gems  := total_gems  + reward.amount;
        when 'xp'    then total_xp    := total_xp    + reward.amount;
        else null;
      end case;
    elsif reward.reward_kind = 'item' then
      if reward.item_table = 'board_theme_configs' then
        insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
        values (caller_id, reward.item_id, 'chest_reward', caller_id)
        on conflict (profile_id, board_theme_id) do nothing;
      else
        insert into public.user_inventory (profile_id, item_table, item_id, source, source_ref_id)
        values (caller_id, reward.item_table, reward.item_id, 'chest_reward', milestone.id::text)
        on conflict (profile_id, item_table, item_id) do nothing;
      end if;
    end if;
  end loop;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins, gems = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;
    if total_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'coins', total_coins, wallet_row.coins, 'chest_reward',
         'Chest: ' || milestone.display_name,
         jsonb_build_object('milestone_index', p_milestone_index), caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'gems', total_gems, wallet_row.gems, 'chest_reward',
         'Chest: ' || milestone.display_name,
         jsonb_build_object('milestone_index', p_milestone_index), caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  if total_xp > 0 then
    update public.profiles set xp = xp + total_xp where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  -- Append to chests_claimed (atomic, no race because of FOR UPDATE).
  update public.player_weekly_pass
  set chests_claimed = chests_claimed || jsonb_build_array(p_milestone_index),
      updated_at = now()
  where profile_id = caller_id and week_key = pass_row.week_key;

  return jsonb_build_object(
    'milestone_index', p_milestone_index,
    'display_name', milestone.display_name,
    'credited_coins', total_coins,
    'credited_gems', total_gems,
    'credited_xp', total_xp,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.claim_chest(int) to authenticated;
comment on function public.claim_chest(int) is
  'Claim a weekly-pass chest milestone. Validates mp_earned ≥ threshold + not already claimed, credits bundle, appends to chests_claimed.';

-- ============================================================
-- Section 4: claim_streak_chest()
-- ============================================================
create or replace function public.claim_streak_chest()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  streak public.player_streak;
  reward record;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  total_coins int := 0;
  total_gems int := 0;
  total_xp int := 0;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  select * into streak from public.player_streak where profile_id = caller_id for update;
  if not found then raise exception 'no_streak'; end if;
  if streak.current_streak_days < 7 then raise exception 'streak_not_ready'; end if;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict do nothing;

  for reward in
    select reward_kind, currency_code, item_table, item_id, amount
    from public.streak_chest_rewards order by display_order
  loop
    if reward.reward_kind = 'currency' then
      case reward.currency_code
        when 'coins' then total_coins := total_coins + reward.amount;
        when 'gems'  then total_gems  := total_gems  + reward.amount;
        when 'xp'    then total_xp    := total_xp    + reward.amount;
        else null;
      end case;
    elsif reward.reward_kind = 'item' then
      if reward.item_table = 'board_theme_configs' then
        insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
        values (caller_id, reward.item_id, 'streak_chest_reward', caller_id)
        on conflict (profile_id, board_theme_id) do nothing;
      else
        insert into public.user_inventory (profile_id, item_table, item_id, source, source_ref_id)
        values (caller_id, reward.item_table, reward.item_id, 'streak_chest_reward', null)
        on conflict (profile_id, item_table, item_id) do nothing;
      end if;
    end if;
  end loop;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins, gems = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;
    if total_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'coins', total_coins, wallet_row.coins, 'streak_chest_reward',
         '7-day streak chest', jsonb_build_object('streak_days_at_claim', streak.current_streak_days), caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'gems', total_gems, wallet_row.gems, 'streak_chest_reward',
         '7-day streak chest', jsonb_build_object('streak_days_at_claim', streak.current_streak_days), caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  if total_xp > 0 then
    update public.profiles set xp = xp + total_xp where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  -- Decrement by 7 (keeps the "overflow" for streaks > 7).
  -- Increment total chests claimed.
  update public.player_streak
  set current_streak_days = greatest(current_streak_days - 7, 0),
      total_streak_chests_claimed = total_streak_chests_claimed + 1,
      updated_at = now()
  where profile_id = caller_id;

  return jsonb_build_object(
    'credited_coins', total_coins,
    'credited_gems', total_gems,
    'credited_xp', total_xp,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level),
    'new_streak_days', greatest(streak.current_streak_days - 7, 0)
  );
end;
$$;

grant execute on function public.claim_streak_chest() to authenticated;
comment on function public.claim_streak_chest() is
  'Claim the 7-day completion streak chest. Subtracts 7 from current_streak_days (keeping overflow) and increments total_streak_chests_claimed.';

-- ============================================================
-- Section 5: reroll_mission(mission_id)
-- ============================================================
create or replace function public.reroll_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  pdm public.player_daily_missions;
  prior_mt public.mission_templates;
  new_template public.mission_templates;
  cfg public.reroll_pricing_config;
  prof public.profiles;
  baseline numeric;
  resolved_goal int;
  rerolls_today int;
  gem_cost int;
  wallet_row public.user_wallets;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  select * into pdm from public.player_daily_missions
  where id = p_mission_id and profile_id = caller_id for update;
  if not found then raise exception 'mission_not_found'; end if;
  if pdm.expires_at <= now() then raise exception 'mission_expired'; end if;
  if pdm.completed_at is not null then raise exception 'mission_already_complete'; end if;
  if pdm.claimed_at is not null then raise exception 'mission_already_claimed'; end if;

  select * into prior_mt from public.mission_templates where id = pdm.mission_template_id;
  select * into cfg from public.reroll_pricing_config where id = 'default';
  if not found then raise exception 'reroll_config_missing'; end if;

  -- Count today's reroll events for this player.
  select count(*) into rerolls_today
  from public.mission_rerolls
  where profile_id = caller_id
    and rerolled_at::date = current_date;

  if rerolls_today >= cfg.daily_cap then
    raise exception 'reroll_cap_reached';
  end if;

  -- gem_cost = ladder[rerolls_today]; clamp to ladder length.
  if rerolls_today >= array_length(cfg.gem_cost_ladder, 1) then
    raise exception 'reroll_cap_reached';
  end if;
  gem_cost := cfg.gem_cost_ladder[rerolls_today + 1];  -- 1-indexed in pg arrays

  -- Pick replacement BEFORE charging gems — if no eligible
  -- template exists, the player shouldn't pay for nothing.
  select * into prof from public.profiles where id = caller_id;

  select t.* into new_template
  from public.mission_templates t
  where t.enabled = true
    and t.period = pdm.period
    and t.rarity = pdm.rarity_slot
    -- eligibility
    and (t.eligibility->>'min_level' is null or (t.eligibility->>'min_level')::int <= prof.level)
    and (t.eligibility->>'max_level' is null or (t.eligibility->>'max_level')::int >= prof.level)
    and (
      not (t.eligibility ? 'requires_rated' and (t.eligibility->>'requires_rated')::boolean)
      or coalesce(prof.pvp_rating, 0) > 0
    )
    -- not the one we're rolling out of
    and t.id <> pdm.mission_template_id
    -- not assigned to this player in last 3 days
    and not exists (
      select 1 from public.player_daily_missions pdm2
      where pdm2.profile_id = caller_id
        and pdm2.mission_template_id = t.id
        and pdm2.assigned_at > now() - interval '3 days'
    )
    -- don't duplicate the mission_type of any currently-active mission
    and t.mission_type <> all(
      select mt.mission_type
      from public.player_daily_missions p
      join public.mission_templates mt on mt.id = p.mission_template_id
      where p.profile_id = caller_id
        and p.expires_at > now()
        and p.id <> pdm.id
    )
  order by random()
  limit 1;

  if new_template.id is null then
    raise exception 'no_replacement_available';
  end if;

  -- Charge gems if needed.
  if gem_cost > 0 then
    insert into public.user_wallets (profile_id) values (caller_id) on conflict do nothing;
    update public.user_wallets
    set gems = gems - gem_cost
    where profile_id = caller_id and gems >= gem_cost
    returning * into wallet_row;

    if wallet_row.profile_id is null then
      raise exception 'insufficient_gems';
    end if;

    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (caller_id, 'gems', -gem_cost, wallet_row.gems, 'mission_reroll_fee',
       'Mission reroll',
       jsonb_build_object('prior_template_id', pdm.mission_template_id,
                          'new_template_id', new_template.id,
                          'rerolls_today', rerolls_today + 1), caller_id);
  end if;

  -- Resolve goal for the new template.
  if new_template.resolution_mode = 'fixed' then
    resolved_goal := new_template.goal_value;
  else
    select pm.baseline_7d into baseline
    from public.player_metrics pm
    where pm.profile_id = caller_id and pm.metric_code = new_template.metric_code;
    baseline := coalesce(baseline, 0);
    resolved_goal := greatest(new_template.goal_min,
      least(new_template.goal_max, greatest(1, ceil(baseline * new_template.stretch_factor)::int)));
  end if;

  -- Replace the mission in-place (preserves the row id, frontend
  -- can refetch without re-keying). Reset progress + assigned_at.
  update public.player_daily_missions
  set mission_template_id = new_template.id,
      resolved_goal = resolved_goal,
      progress = 0,
      completed_at = null,
      assigned_at = now()
  where id = p_mission_id;

  -- Log the reroll event for accurate "count today" on subsequent calls.
  insert into public.mission_rerolls
    (profile_id, gem_cost, prior_template_id, new_template_id, player_daily_mission_id)
  values
    (caller_id, gem_cost, pdm.mission_template_id, new_template.id, p_mission_id);

  return jsonb_build_object(
    'mission_id', p_mission_id,
    'new_template_id', new_template.id,
    'title', new_template.title,
    'subtitle', new_template.subtitle,
    'icon_url', new_template.icon_url,
    'rarity', new_template.rarity,
    'resolved_goal', resolved_goal,
    'gem_cost', gem_cost,
    'rerolls_today', rerolls_today + 1,
    'next_reroll_cost', case
      when rerolls_today + 1 >= cfg.daily_cap then null
      when rerolls_today + 1 >= array_length(cfg.gem_cost_ladder, 1) then null
      else cfg.gem_cost_ladder[rerolls_today + 2]
    end,
    'wallet_gems', coalesce(wallet_row.gems,
      (select gems from public.user_wallets where profile_id = caller_id))
  );
end;
$$;

grant execute on function public.reroll_mission(uuid) to authenticated;
comment on function public.reroll_mission(uuid) is
  'Swap a daily mission for a different one in the same rarity pool. Charges gems per the escalating ladder in reroll_pricing_config. Anti-repeats against last-3-days assignments AND currently-active mission types. Updates the row in place.';

-- ============================================================
-- Section 6: daily_streak_rollover() — nightly streak reset.
-- ============================================================
create or replace function public.daily_streak_rollover()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reset_count int;
begin
  with reset as (
    update public.player_streak
    set current_streak_days = 0, updated_at = now()
    where current_streak_days > 0
      and (last_complete_date is null or last_complete_date < current_date - 1)
    returning 1
  )
  select count(*) into reset_count from reset;
  return reset_count;
end;
$$;

comment on function public.daily_streak_rollover() is
  'Zeros current_streak_days for any player whose last_complete_date is older than yesterday. Run nightly by pg_cron.';

-- ============================================================
-- Section 7: cron schedule for streak rollover.
-- 00:15 UTC — after daily assignment (00:00), before metric
-- recompute (02:00). Doesn't actually matter for correctness;
-- this slot keeps the night-cron sequence chronological.
-- ============================================================
do $j$
begin
  perform cron.unschedule('daily-streak-rollover');
exception when others then null;
end;
$j$;

select cron.schedule(
  'daily-streak-rollover',
  '15 0 * * *',
  $cron$select public.daily_streak_rollover()$cron$
);
