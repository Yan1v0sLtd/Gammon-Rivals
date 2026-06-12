-- Make claim_daily_bonus respect the player's active XP multiplier.
--
-- Behaviour:
--   * Resolve the multiplier via current_xp_multiplier() before applying
--     reward_xp. Default 1 means "no active boost" and the math is a no-op.
--   * The DB stores the boosted amount on profiles.xp; the audit trail in
--     the return payload includes both reward_xp_base and reward_xp so the
--     client can show "Day N reward + ×2 boost".
--   * Nothing else changes: streak math, claim-window guard, ledger rows,
--     and return shape are all identical to the 20260521 version, plus
--     two new keys: reward_xp_base and xp_multiplier.

create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  today_et date := (now() at time zone 'America/New_York')::date;
  state_row public.user_daily_bonuses;
  cfg_row public.daily_bonus_configs;
  effective_day int;
  next_day int;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  xp_mult int;
  reward_xp_final int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.user_daily_bonuses (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  select * into state_row
  from public.user_daily_bonuses
  where profile_id = caller_id
  for update;

  if state_row.last_claim_date_et = today_et then
    raise exception 'already_claimed';
  end if;

  if state_row.last_claim_date_et is null
     or state_row.last_claim_date_et < today_et - 1 then
    effective_day := 1;
  else
    effective_day := state_row.current_day;
  end if;

  select * into cfg_row
  from public.daily_bonus_configs
  where day = effective_day;
  if not found then
    raise exception 'config_missing_for_day_%', effective_day;
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  update public.user_wallets
  set coins = coins + cfg_row.reward_coins,
      gems = gems + cfg_row.reward_gems
  where profile_id = caller_id
  returning * into wallet_row;

  if cfg_row.reward_coins > 0 then
    insert into public.wallet_transactions (
      profile_id, currency, amount, balance_after, source, reason, metadata, created_by
    ) values (
      caller_id,
      'coins',
      cfg_row.reward_coins,
      wallet_row.coins,
      'daily_bonus',
      'Daily bonus day ' || effective_day,
      jsonb_build_object('day', effective_day, 'date_et', today_et),
      caller_id
    );
  end if;

  if cfg_row.reward_gems > 0 then
    insert into public.wallet_transactions (
      profile_id, currency, amount, balance_after, source, reason, metadata, created_by
    ) values (
      caller_id,
      'gems',
      cfg_row.reward_gems,
      wallet_row.gems,
      'daily_bonus',
      'Daily bonus day ' || effective_day,
      jsonb_build_object('day', effective_day, 'date_et', today_et),
      caller_id
    );
  end if;

  -- XP, scaled by any active boost. Pull the multiplier *after* the
  -- streak/claim guards so we don't trigger an extra lookup on the
  -- already_claimed error path.
  xp_mult := public.current_xp_multiplier(caller_id);
  reward_xp_final := cfg_row.reward_xp * xp_mult;
  if reward_xp_final > 0 then
    update public.profiles
    set xp = xp + reward_xp_final
    where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  next_day := (effective_day % 7) + 1;
  update public.user_daily_bonuses
  set current_day = next_day,
      last_claim_date_et = today_et,
      last_claim_at = now()
  where profile_id = caller_id;

  return jsonb_build_object(
    'day_claimed', effective_day,
    'reward_coins', cfg_row.reward_coins,
    'reward_gems', cfg_row.reward_gems,
    'reward_xp', reward_xp_final,
    'reward_xp_base', cfg_row.reward_xp,
    'xp_multiplier', xp_mult,
    'next_day', next_day,
    'claim_date_et', today_et,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.claim_daily_bonus() to authenticated;

comment on function public.claim_daily_bonus() is
  'Atomic daily-bonus claim with XP-boost multiplier. Rolls over at midnight ET. Streak resets to day 1 after a missed day; cycles 7 -> 1 after day 7. Credits coins+gems via user_wallets, logs wallet_transactions (skips zero-amount rows), adds XP to profiles scaled by current_xp_multiplier(). Returns jsonb with day_claimed, reward_*, reward_xp_base, xp_multiplier, next_day, wallet, profile. Raises: not_authenticated, already_claimed, config_missing_for_day_N.';
