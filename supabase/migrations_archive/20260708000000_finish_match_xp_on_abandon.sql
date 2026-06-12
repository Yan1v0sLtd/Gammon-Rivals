-- finish_match: award XP even when a player ABANDONS a (paid) tiered match.
-- Rationale: the entry fee was already paid, so the player keeps the XP regardless
-- of win / loss / abandon. (Coins on abandon are unchanged — an abandon still
-- forfeits the coin prize/refund; only XP is now granted.)
--
-- Diff vs the previous version: the two `if not *_abandoned then ... end if;`
-- guards around the XP calculation are removed. Everything else is identical.

CREATE OR REPLACE FUNCTION public.finish_match(p_match_id uuid, p_white_score integer, p_black_score integer, p_winner text, p_crawford_game_number integer DEFAULT NULL::integer, p_owner_abandoned boolean DEFAULT false, p_opponent_abandoned boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
  cfg public.table_configs;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  is_pvp boolean;
  xp_mult int;
  xp_awarded int;
  coins_awarded int;
  owner_won boolean;
  prior_difficulty_matches int := 0;
  risk_free_applied boolean := false;
  pvp_pot int := 0;
  pvp_rake int := 0;
  pvp_winner_coins int := 0;
  pvp_loser_coins int := 0;
  owner_rating int;
  opponent_rating int;
  owner_expected float;
  owner_score float;
  owner_new_rating int;
  opponent_new_rating int;
  k_factor constant int := 32;
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
  if caller_id <> match_row.owner_id and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
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
  is_pvp := match_row.opponent_id is not null;

  if match_row.table_config_id is not null then
    select * into cfg from public.table_configs where id = match_row.table_config_id;
  end if;

  if cfg.id is not null and is_pvp then
    pvp_pot          := 2 * cfg.entry_fee_coins;
    pvp_rake         := pvp_pot * cfg.pvp_rake_pct / 100;
    pvp_loser_coins  := cfg.prize_coins_loss;
    pvp_winner_coins := pvp_pot - pvp_rake - pvp_loser_coins;
    if pvp_winner_coins < 0 then
      pvp_winner_coins := 0;
    end if;
  end if;

  if cfg.id is not null then
    -- XP is earned for any paid (tiered) match — win, loss, OR abandon. The entry
    -- fee was already paid, so the player keeps the XP regardless of outcome.
    xp_mult := public.current_xp_multiplier(match_row.owner_id);
    xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * xp_mult;

    -- Coins UNCHANGED: an abandon still forfeits the coin prize/refund (0 coins).
    if owner_won then
      if is_pvp then
        coins_awarded := pvp_winner_coins;
      else
        coins_awarded := cfg.prize_coins;
      end if;
    elsif p_owner_abandoned then
      coins_awarded := 0;
    else
      if is_pvp then
        coins_awarded := pvp_loser_coins;
      else
        coins_awarded := cfg.prize_coins_loss;
        select count(*) into prior_difficulty_matches
        from public.matches
        where owner_id = match_row.owner_id
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
    end if;

    if xp_awarded > 0 then
      update public.profiles
      set xp = xp + xp_awarded
      where id = match_row.owner_id
      returning * into profile_row;
    else
      select * into profile_row from public.profiles where id = match_row.owner_id;
    end if;

    insert into public.user_wallets (profile_id)
    values (match_row.owner_id)
    on conflict (profile_id) do nothing;

    if coins_awarded > 0 then
      update public.user_wallets
      set coins = coins + coins_awarded
      where profile_id = match_row.owner_id
      returning * into wallet_row;
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (match_row.owner_id, 'coins', coins_awarded, wallet_row.coins, 'match_reward',
         case
           when owner_won then 'Match win: '
           when risk_free_applied then 'Risk-free refund: '
           else 'Match consolation: '
         end || cfg.display_name,
         jsonb_build_object(
           'match_id', p_match_id,
           'table_config_id', cfg.id,
           'owner_won', owner_won,
           'risk_free', risk_free_applied,
           'is_pvp', is_pvp,
           'pvp_pot', case when is_pvp then pvp_pot else null end,
           'pvp_rake', case when is_pvp then pvp_rake else null end,
           'pvp_rake_pct', case when is_pvp then cfg.pvp_rake_pct else null end
         ),
         match_row.owner_id);
    else
      select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    end if;

    if is_pvp then
      declare
        opponent_won boolean := not owner_won;
        opp_xp_mult int := 1;
        opp_xp_awarded int := 0;
        opp_coins_awarded int := 0;
        opp_wallet public.user_wallets;
      begin
        -- Opponent also keeps XP regardless of win / loss / abandon.
        opp_xp_mult := public.current_xp_multiplier(match_row.opponent_id);
        opp_xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * opp_xp_mult;

        if opponent_won then
          opp_coins_awarded := pvp_winner_coins;
        elsif p_opponent_abandoned then
          opp_coins_awarded := 0;
        else
          opp_coins_awarded := pvp_loser_coins;
        end if;

        if opp_xp_awarded > 0 then
          update public.profiles
          set xp = xp + opp_xp_awarded
          where id = match_row.opponent_id;
        end if;

        insert into public.user_wallets (profile_id)
        values (match_row.opponent_id)
        on conflict (profile_id) do nothing;

        if opp_coins_awarded > 0 then
          update public.user_wallets
          set coins = coins + opp_coins_awarded
          where profile_id = match_row.opponent_id
          returning * into opp_wallet;
          insert into public.wallet_transactions
            (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
          values
            (match_row.opponent_id, 'coins', opp_coins_awarded, opp_wallet.coins, 'match_reward',
             case when opponent_won then 'Match win: ' else 'Match consolation: ' end || cfg.display_name,
             jsonb_build_object(
               'match_id', p_match_id,
               'table_config_id', cfg.id,
               'owner_won', owner_won,
               'is_pvp', true,
               'role', 'opponent',
               'pvp_pot', pvp_pot,
               'pvp_rake', pvp_rake,
               'pvp_rake_pct', cfg.pvp_rake_pct
             ),
             match_row.opponent_id);
        end if;
      end;
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    select * into profile_row from public.profiles where id = match_row.owner_id;
  end if;

  if is_pvp and p_winner is not null then
    select pvp_rating into owner_rating from public.profiles where id = match_row.owner_id;
    select pvp_rating into opponent_rating from public.profiles where id = match_row.opponent_id;
    owner_rating := coalesce(owner_rating, 1500);
    opponent_rating := coalesce(opponent_rating, 1500);

    owner_expected := 1.0 / (1.0 + power(10.0, (opponent_rating - owner_rating)::float / 400.0));
    owner_score := case when owner_won then 1.0 else 0.0 end;

    owner_new_rating := greatest(0, least(4000,
      owner_rating + round(k_factor * (owner_score - owner_expected))::int));
    opponent_new_rating := greatest(0, least(4000,
      opponent_rating + round(k_factor * ((1.0 - owner_score) - (1.0 - owner_expected)))::int));

    update public.profiles set pvp_rating = owner_new_rating where id = match_row.owner_id;
    update public.profiles set pvp_rating = opponent_new_rating where id = match_row.opponent_id;
  end if;

  return jsonb_build_object(
    'match_id', match_row.id,
    'owner_won', owner_won,
    'is_pvp', is_pvp,
    'xp_awarded', xp_awarded,
    'xp_multiplier', xp_mult,
    'coins_awarded', coins_awarded,
    'risk_free_applied', risk_free_applied,
    'pvp_pot', case when is_pvp then pvp_pot else null end,
    'pvp_rake', case when is_pvp then pvp_rake else null end,
    'owner_rating', owner_new_rating,
    'opponent_rating', opponent_new_rating,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$function$;
