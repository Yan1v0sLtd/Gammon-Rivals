-- Personalized missions — integration step 2c: claim grants the snapshotted
-- reward. The ONLY change vs 20260625 claim_mission is the reward block: a
-- personalized mission (player_daily_missions.reward_coins not null) grants that
-- snapshotted coin amount; legacy missions still walk their template's
-- mission_rewards bundle. Everything else (wallet credit, MP, streak, claim
-- mark, meta-mission fire) is unchanged.

create or replace function public.claim_mission(
  p_mission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  pdm public.player_daily_missions;
  mt public.mission_templates;
  reward record;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  total_coins int := 0;
  total_gems int := 0;
  total_xp int := 0;
  mp_award int := 0;
  v_week_key text := to_char(now(), 'IYYY-"W"IW');
  unclaimed_today int;
  prior_streak int;
  prior_last_date date;
  new_streak int;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  select * into pdm from public.player_daily_missions
  where id = p_mission_id and profile_id = caller_id
  for update;

  if not found then raise exception 'mission_not_found'; end if;
  if pdm.completed_at is null then raise exception 'mission_not_complete'; end if;
  if pdm.claimed_at is not null then raise exception 'already_claimed'; end if;
  if pdm.expires_at <= now() then raise exception 'mission_expired'; end if;

  select * into mt from public.mission_templates where id = pdm.mission_template_id;

  -- Reward: personalized missions grant the per-player snapshotted coin reward;
  -- legacy missions walk their template's reward bundle.
  if pdm.reward_coins is not null then
    total_coins := pdm.reward_coins;
  else
    for reward in
      select reward_kind, currency_code, item_table, item_id, amount
      from public.mission_rewards
      where mission_id = pdm.mission_template_id
      order by display_order
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
          insert into public.user_board_inventory
            (profile_id, board_theme_id, source, granted_by)
          values
            (caller_id, reward.item_id, 'mission_reward', caller_id)
          on conflict (profile_id, board_theme_id) do nothing;
        else
          insert into public.user_inventory
            (profile_id, item_table, item_id, source, source_ref_id)
          values
            (caller_id, reward.item_table, reward.item_id,
             'mission_reward', pdm.mission_template_id::text)
          on conflict (profile_id, item_table, item_id) do nothing;
        end if;
      end if;
    end loop;
  end if;

  insert into public.user_wallets (profile_id) values (caller_id)
  on conflict (profile_id) do nothing;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins, gems = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;

    if total_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'coins', total_coins, wallet_row.coins, 'mission_reward',
         'Mission: ' || mt.title,
         jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
         caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'gems', total_gems, wallet_row.gems, 'mission_reward',
         'Mission: ' || mt.title,
         jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
         caller_id);
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

  mp_award := mt.mission_points;
  if mp_award > 0 then
    insert into public.player_weekly_pass (profile_id, week_key, mp_earned)
    values (caller_id, v_week_key, mp_award)
    on conflict (profile_id, week_key) do update set
      mp_earned = public.player_weekly_pass.mp_earned + excluded.mp_earned,
      updated_at = now();
  end if;

  update public.player_daily_missions set claimed_at = now() where id = p_mission_id;

  select count(*) into unclaimed_today
  from public.player_daily_missions
  where profile_id = caller_id
    and period = 'daily'
    and expires_at > now()
    and claimed_at is null;

  if unclaimed_today = 0 then
    select current_streak_days, last_complete_date
      into prior_streak, prior_last_date
    from public.player_streak
    where profile_id = caller_id;

    if prior_last_date = current_date then
      new_streak := coalesce(prior_streak, 1);
    elsif prior_last_date = current_date - 1 then
      new_streak := coalesce(prior_streak, 0) + 1;
    else
      new_streak := 1;
    end if;

    insert into public.player_streak
      (profile_id, current_streak_days, last_complete_date)
    values
      (caller_id, new_streak, current_date)
    on conflict (profile_id) do update set
      current_streak_days = excluded.current_streak_days,
      last_complete_date  = excluded.last_complete_date,
      updated_at = now();
  end if;

  perform public.progress_mission(
    caller_id,
    'missions_claimed_per_day',
    1,
    'claim:' || p_mission_id::text
  );

  return jsonb_build_object(
    'mission_id', p_mission_id,
    'credited_coins', total_coins,
    'credited_gems', total_gems,
    'credited_xp', total_xp,
    'mp_awarded', mp_award,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level),
    'streak_days', coalesce(new_streak, prior_streak),
    'slate_complete', unclaimed_today = 0
  );
end;
$$;

grant execute on function public.claim_mission(uuid) to authenticated;
