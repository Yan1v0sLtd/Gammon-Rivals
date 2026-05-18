-- Atomic daily-bonus claim. Implements the streak rules locked in
-- during product review:
--
--   * Boundary uses the America/New_York calendar date so claims roll
--     over at midnight ET, not UTC.
--   * If the player has never claimed, or the last claim was 2+ ET
--     days ago, the streak resets to day 1.
--   * If the last claim was yesterday (ET), the player claims their
--     current_day reward.
--   * If the last claim was today (ET), the call errors with
--     'already_claimed'.
--   * After a successful claim, current_day advances to (mod 7)+1 so
--     the cycle loops back to day 1 forever.
--
-- Credits coins / gems via user_wallets + logs wallet_transactions
-- (one row per non-zero currency). XP is added to profiles.xp; the
-- client derives level from xp via the existing levelConfigs ladder
-- (no DB-side level recompute needed for v1).
--
-- Returns a jsonb payload the modal renders:
--   { day_claimed, reward_coins, reward_gems, reward_xp,
--     next_day, claim_date_et, wallet: {coins, gems},
--     profile: {xp, level} }

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
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- The profile trigger creates this row on signup; existing profiles
  -- were backfilled in the previous migration. Defensive insert just
  -- in case a profile predates the trigger and somehow missed backfill.
  insert into public.user_daily_bonuses (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  -- Lock the streak row so two parallel claims can't both succeed.
  select * into state_row
  from public.user_daily_bonuses
  where profile_id = caller_id
  for update;

  if state_row.last_claim_date_et = today_et then
    raise exception 'already_claimed';
  end if;

  -- Decide which day's reward this claim grants.
  -- Streak resets to 1 if there's no prior claim, or if the gap is >= 2 ET days.
  if state_row.last_claim_date_et is null
     or state_row.last_claim_date_et < today_et - 1 then
    effective_day := 1;
  else
    -- last_claim_date_et = today_et - 1 (consecutive)
    effective_day := state_row.current_day;
  end if;

  select * into cfg_row
  from public.daily_bonus_configs
  where day = effective_day;
  if not found then
    raise exception 'config_missing_for_day_%', effective_day;
  end if;

  -- Ensure wallet exists (mirrors admin_adjust_wallet pattern).
  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  -- Credit coins + gems in one update so balance_after is consistent.
  update public.user_wallets
  set coins = coins + cfg_row.reward_coins,
      gems = gems + cfg_row.reward_gems
  where profile_id = caller_id
  returning * into wallet_row;

  -- One ledger row per non-zero currency (CHECK amount <> 0 forbids zero).
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

  -- Add XP. Level is derived on the client from levelConfigs; we don't
  -- recompute it here.
  if cfg_row.reward_xp > 0 then
    update public.profiles
    set xp = xp + cfg_row.reward_xp
    where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  -- Advance streak: 7 -> 1 (loop), else +1.
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
    'reward_xp', cfg_row.reward_xp,
    'next_day', next_day,
    'claim_date_et', today_et,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.claim_daily_bonus() to authenticated;

comment on function public.claim_daily_bonus() is
  'Atomic daily-bonus claim. Rolls over at midnight ET. Streak resets to day 1 after a missed day; cycles 7 -> 1 after day 7. Credits coins+gems via user_wallets, logs wallet_transactions (skips zero-amount rows), adds XP to profiles. Returns jsonb with day_claimed, reward_*, next_day, wallet, profile. Raises: not_authenticated, already_claimed, config_missing_for_day_N.';
