-- finish_match v3: PvP outcomes (zero-payout abandoner + ELO update).
--
-- Two behaviour changes layered onto the existing v2 logic. Solo AI
-- matches behave exactly as before; the new branches only fire when
-- the match row has both owner_id and opponent_id set (i.e. it came
-- from find_match_in_tier).
--
-- 1. Abandonment penalty. Per product call, a player who abandons a
--    PvP match (no payment of either kind on their side) gets zero
--    payout — no lose-prize, no risk-free refund. The winning side
--    still receives prize_coins. The signal that someone abandoned
--    is conveyed via the new p_owner_abandoned argument — the client
--    sets it when finalising a forfeit-on-timeout or similar. For a
--    "regular" lost-by-play PvP match the loser still gets
--    prize_coins_loss (we want them to come back, not feel robbed).
--
-- 2. ELO update. Each side's pvp_rating shifts by a standard 32-K-
--    factor ELO update based on the match outcome. Winners gain
--    rating, losers lose it; magnitudes depend on the rating gap so
--    upsets move more rating than expected results. We compute both
--    sides' new rating in plpgsql (no separate function — the math
--    is short).
--
-- We also update the AI-match path to grant XP + rewards to the
-- opponent_id side when an AI match's caller is the opponent (a
-- defence-in-depth: enter_room only sets owner_id today, so this is
-- a no-op for current AI rows, but it makes the function symmetric
-- for the upcoming "AI as both sides for invite_code matches" case).

create or replace function public.finish_match(
  p_match_id uuid,
  p_white_score int,
  p_black_score int,
  p_winner text,
  p_crawford_game_number int default null,
  p_owner_abandoned boolean default false,
  p_opponent_abandoned boolean default false
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
  is_pvp boolean;
  xp_mult int;
  xp_awarded int;
  coins_awarded int;
  owner_won boolean;
  prior_difficulty_matches int := 0;
  risk_free_applied boolean := false;
  -- ELO update working set:
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
  -- Either side of a PvP match can finalise; AI-only rows still require
  -- the owner (no opponent_id exists to authorise from the other side).
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

  -- ------------------------------------------------------------------
  -- 1. Owner-side payout. The "owner won" / "owner lost" branches both
  -- key off owner_won; abandonment overrides the lose path to grant 0.
  -- ------------------------------------------------------------------
  if cfg.id is not null then
    if owner_won then
      xp_mult := public.current_xp_multiplier(match_row.owner_id);
      xp_awarded := (cfg.base_xp_win * cfg.xp_multiplier_pct / 100) * xp_mult;
      coins_awarded := cfg.prize_coins;
    elsif p_owner_abandoned then
      -- PvP abandoner: no payout at all. Skip the risk-free upgrade.
      coins_awarded := 0;
    else
      coins_awarded := cfg.prize_coins_loss;
      -- Risk-free intro only applies to AI matches — PvP "polished"
      -- losses don't get a wallet warranty.
      if not is_pvp then
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
           'is_pvp', is_pvp
         ),
         match_row.owner_id);
    else
      select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    end if;

    -- ----------------------------------------------------------------
    -- 2. Opponent-side payout (PvP only). The opponent wins iff the
    -- owner lost. Symmetric reward logic — XP, coins, no risk-free.
    -- ----------------------------------------------------------------
    if is_pvp then
      declare
        opponent_won boolean := not owner_won;
        opp_xp_mult int := 1;
        opp_xp_awarded int := 0;
        opp_coins_awarded int := 0;
        opp_wallet public.user_wallets;
      begin
        if opponent_won then
          opp_xp_mult := public.current_xp_multiplier(match_row.opponent_id);
          opp_xp_awarded := (cfg.base_xp_win * cfg.xp_multiplier_pct / 100) * opp_xp_mult;
          opp_coins_awarded := cfg.prize_coins;
        elsif p_opponent_abandoned then
          opp_coins_awarded := 0;
        else
          opp_coins_awarded := cfg.prize_coins_loss;
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
               'role', 'opponent'
             ),
             match_row.opponent_id);
        end if;
      end;
    end if;
  else
    -- No table_config attached — legacy match. Fall back to plain row
    -- snapshot so the return payload still has wallet/profile data.
    select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    select * into profile_row from public.profiles where id = match_row.owner_id;
  end if;

  -- --------------------------------------------------------------------
  -- 3. ELO update (PvP only). Standard ELO with K=32; abandonment is
  -- treated as a regular loss for the purposes of rating movement, so
  -- you can't tank your rating by quitting without consequence.
  -- --------------------------------------------------------------------
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
    'owner_rating', owner_new_rating,
    'opponent_rating', opponent_new_rating,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.finish_match(uuid, int, int, text, int, boolean, boolean) to authenticated;

-- Drop the old signature so the new one is the only callable shape.
drop function if exists public.finish_match(uuid, int, int, text, int);

comment on function public.finish_match(uuid, int, int, text, int, boolean, boolean) is
  'Match completion + reward grant. AI path unchanged: prize_coins on win, prize_coins_loss on loss, risk-free refund for the first 10 difficulty matches. PvP path: symmetric payouts for both sides, no risk-free, ELO update on both pvp_ratings. Abandoners (p_owner_abandoned / p_opponent_abandoned) get zero payout but still take the ELO hit. Idempotent (raises match_already_finished). Returns jsonb with rewards + post-update ratings.';
