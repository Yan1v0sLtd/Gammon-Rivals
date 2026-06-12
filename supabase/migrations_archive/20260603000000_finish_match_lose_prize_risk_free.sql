-- finish_match v2: lose-prize + risk-free first 10 matches.
--
-- Two additions to the reward grant:
--
--   1. Lose-prize. When the owner loses a difficulty-tagged match, we
--      now refund prize_coins_loss (set per-tier in table_configs).
--      Pairs with the existing win-prize so the payout curve hits the
--      tier's target_rtp_pct at the assumed win probability.
--
--   2. Risk-free intro. For each player's first 10 finished
--      difficulty-room matches, a loss is upgraded to a full entry-fee
--      refund (whichever is larger between prize_coins_loss and
--      entry_fee_coins). Onboards new players without their wallet
--      bleeding out before they learn the game. After 10 matches the
--      regular lose-prize takes over.
--
-- Counting "matches played so far" excludes the match currently being
-- finalised (we check before bumping finished_at). The match row is
-- updated first; then we count `where finished_at is not null and id <>
-- p_match_id` to get the prior-finished count. This keeps the boundary
-- inclusive of THIS match for future calls (so the 11th match doesn't
-- accidentally get refunded if it finalises first).
--
-- Everything outside the new lose-prize / refund branch is unchanged
-- from the previous version.

create or replace function public.finish_match(
  p_match_id uuid,
  p_white_score int,
  p_black_score int,
  p_winner text,
  p_crawford_game_number int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
  cfg public.table_configs;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  xp_mult int;
  xp_awarded int;
  coins_awarded int;
  owner_won boolean;
  prior_difficulty_matches int := 0;
  risk_free_applied boolean := false;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_winner is not null and p_winner not in ('white', 'black') then
    raise exception 'invalid_winner';
  end if;

  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if match_row.owner_id <> caller_id then
    raise exception 'not_match_owner';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  update public.matches
  set white_score = p_white_score,
      black_score = p_black_score,
      winner = p_winner,
      crawford_game_number = p_crawford_game_number,
      finished_at = now()
  where id = p_match_id
  returning * into match_row;

  xp_awarded := 0;
  coins_awarded := 0;
  xp_mult := 1;
  owner_won := (p_winner is not null and p_winner = match_row.owner_color);

  if match_row.table_config_id is not null then
    select * into cfg from public.table_configs where id = match_row.table_config_id;

    if found then
      if owner_won then
        -- Standard win path: XP + win-prize.
        xp_mult := public.current_xp_multiplier(caller_id);
        xp_awarded := (cfg.base_xp_win * cfg.xp_multiplier_pct / 100) * xp_mult;
        coins_awarded := cfg.prize_coins;
      else
        -- Loss path: tier-configured lose-prize, no XP. Risk-free
        -- intro upgrades the payout to entry_fee_coins for the
        -- player's first 10 difficulty matches.
        coins_awarded := cfg.prize_coins_loss;

        select count(*) into prior_difficulty_matches
        from public.matches
        where owner_id = caller_id
          and table_config_id is not null
          and finished_at is not null
          and id <> p_match_id;

        if prior_difficulty_matches < 10 then
          if cfg.entry_fee_coins > coins_awarded then
            coins_awarded := cfg.entry_fee_coins;
            risk_free_applied := true;
          end if;
        end if;
      end if;

      if xp_awarded > 0 then
        update public.profiles
        set xp = xp + xp_awarded
        where id = caller_id
        returning * into profile_row;
      else
        select * into profile_row from public.profiles where id = caller_id;
      end if;

      insert into public.user_wallets (profile_id)
      values (caller_id)
      on conflict (profile_id) do nothing;

      if coins_awarded > 0 then
        update public.user_wallets
        set coins = coins + coins_awarded
        where profile_id = caller_id
        returning * into wallet_row;
        insert into public.wallet_transactions
          (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
        values
          (caller_id, 'coins', coins_awarded, wallet_row.coins, 'match_reward',
           case
             when owner_won then 'Match win: '
             when risk_free_applied then 'Risk-free refund: '
             else 'Match consolation: '
           end || cfg.display_name,
           jsonb_build_object(
             'match_id', p_match_id,
             'table_config_id', cfg.id,
             'owner_won', owner_won,
             'risk_free', risk_free_applied
           ),
           caller_id);
      else
        select * into wallet_row from public.user_wallets where profile_id = caller_id;
      end if;
    else
      select * into wallet_row from public.user_wallets where profile_id = caller_id;
      select * into profile_row from public.profiles where id = caller_id;
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  return jsonb_build_object(
    'match_id', match_row.id,
    'owner_won', owner_won,
    'xp_awarded', xp_awarded,
    'xp_multiplier', xp_mult,
    'coins_awarded', coins_awarded,
    'risk_free_applied', risk_free_applied,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.finish_match(uuid, int, int, text, int) to authenticated;

comment on function public.finish_match(uuid, int, int, text, int) is
  'Atomic match completion. Win: grants prize_coins + base_xp_win*xp_multiplier_pct/100 (scaled by current_xp_multiplier). Loss: grants prize_coins_loss; for the player''s first 10 difficulty matches, that payout is upgraded to entry_fee_coins as a risk-free intro. Idempotent (raises match_already_finished). Returns jsonb {match_id, owner_won, xp_awarded, xp_multiplier, coins_awarded, risk_free_applied, wallet, profile}.';
