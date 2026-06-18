-- Phase 2b slice 5 — server-authoritative payout on the DERIVED result.
--
-- finish_match paid on the CLIENT-asserted p_winner. For an online (PvP) match
-- whose record is now server-locked (slice 4) and validated turn-by-turn (slice
-- 3), the server already KNOWS the true winner — commit_turn_server derives it
-- from the replayed moves. This slice makes the PAYOUT use that derived winner:
--
--   * grant_match_reward(match_id, winner, owner_abandoned, opponent_abandoned)
--     — the reward engine, extracted verbatim from finish_match's reward block
--     (coins/XP/risk-free/PvP-rake/opponent payout/ELO, entry_fee_paid_at gate).
--     No auth.uid(); reads the (already-finalized) match row. service_role only.
--   * finish_match — thin: auth + finalize the match row + delegate to
--     grant_match_reward. Behaviour for its existing callers (HotSeat AI via
--     finishMatchRpc; finalizeMatch forfeit) is UNCHANGED — same reward math.
--   * commit_turn_server — when a validated turn ENDS the match, it now calls
--     grant_match_reward with the DERIVED p_match_winner. This (a) closes the
--     PvP-natural coin-mint (payout no longer trusts the client) and (b) fixes
--     the pre-existing gap where a natural PvP bear-off win paid nothing
--     (finish_match was only ever called on abandon/resign).
--
-- Still trusting the client (closed later): HotSeat AI finish_match (layer 2 —
-- AI moves aren't server-authored yet, so a recorded AI game is forgeable) and
-- the forfeit path (needs server-side abandonment verification). grant_match_reward
-- is the reusable reward fn layer 2 will call once AI games are server-driven.

-- ---------------------------------------------------------------------------
-- grant_match_reward — reward engine (extracted from finish_match verbatim).
-- ---------------------------------------------------------------------------
create or replace function public.grant_match_reward(
  p_match_id uuid,
  p_winner text,
  p_owner_abandoned boolean default false,
  p_opponent_abandoned boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
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
  -- The caller (finish_match or commit_turn_server) has already finalized the
  -- match row (winner/scores/finished_at). Read it back to pay out.
  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

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

  -- Pay coins/XP ONLY when the match carries a real server-charged entry
  -- (entry_fee_paid_at). A client-forged match row has table_config_id set but
  -- no stamp -> this whole block is skipped -> 0 reward.
  if cfg.id is not null and match_row.entry_fee_paid_at is not null then
    xp_mult := public.current_xp_multiplier(match_row.owner_id);
    xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * xp_mult;

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

  -- Rating only moves for a real paid (ranked) PvP match.
  if is_pvp and p_winner is not null and match_row.entry_fee_paid_at is not null then
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

revoke execute on function public.grant_match_reward(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.grant_match_reward(uuid, text, boolean, boolean) to service_role;

comment on function public.grant_match_reward(uuid, text, boolean, boolean) is
  'Phase 2b: reward engine — pays coins/XP/ELO for a finalized match per the derived/asserted winner. Reads the already-finalized match row; preserves the v4 PvP-rake + risk-free + entry_fee_paid_at gate exactly. Called by finish_match (RPC) and commit_turn_server (with the server-derived winner). service_role only.';

-- ---------------------------------------------------------------------------
-- finish_match — thin: auth + finalize the row + delegate the payout.
-- (create or replace preserves the existing grant to authenticated.)
-- ---------------------------------------------------------------------------
create or replace function public.finish_match(p_match_id uuid, p_white_score integer, p_black_score integer, p_winner text, p_crawford_game_number integer default null::integer, p_owner_abandoned boolean default false, p_opponent_abandoned boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
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
  where id = p_match_id;

  return public.grant_match_reward(p_match_id, p_winner, p_owner_abandoned, p_opponent_abandoned);
end;
$function$;

-- ---------------------------------------------------------------------------
-- commit_turn_server — pay the DERIVED winner when a turn ends the match.
-- (Identical to slice 3 plus the grant_match_reward call on match_ended.)
-- ---------------------------------------------------------------------------
create or replace function public.commit_turn_server(
  p_match_id uuid,
  p_caller_id uuid,
  p_dice int[],
  p_sub_moves jsonb,
  p_game_winner text default null,
  p_game_win_type text default null,
  p_game_points int default null,
  p_game_dropped_double boolean default false,
  p_new_white_score int default null,
  p_new_black_score int default null,
  p_match_winner text default null,
  p_crawford_game_number int default null,
  p_elapsed_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  match_row public.matches;
  ct jsonb;
  ct_player text;
  caller_color text;
  next_ply int;
  game_ended boolean := p_game_winner is not null;
  match_ended boolean := p_match_winner is not null;
begin
  if p_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into match_row from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  if p_caller_id <> match_row.owner_id
     and (match_row.opponent_id is null or p_caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;

  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  ct := match_row.current_turn;
  if ct is null then
    raise exception 'no_turn_in_progress';
  end if;

  ct_player := ct ->> 'player';
  if ct_player not in ('white', 'black') then
    raise exception 'malformed_current_turn';
  end if;

  if p_caller_id = match_row.owner_id then
    caller_color := case
      when coalesce(match_row.owner_color, 'white') = 'black' then 'black'
      else 'white'
    end;
  else
    caller_color := case
      when coalesce(match_row.owner_color, 'white') = 'white' then 'black'
      else 'white'
    end;
  end if;

  if caller_color <> ct_player then
    raise exception 'not_your_turn';
  end if;

  if match_row.current_game_id is null then
    raise exception 'no_current_game';
  end if;

  select coalesce(max(ply), -1) + 1 into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (
    match_row.current_game_id,
    next_ply,
    ct_player,
    p_dice,
    coalesce(p_sub_moves, '[]'::jsonb),
    p_elapsed_ms
  );

  if game_ended then
    update public.games
    set winner = p_game_winner,
        win_type = p_game_win_type,
        cube_value = match_row.cube_value,
        cube_owner = match_row.cube_owner,
        points_awarded = coalesce(p_game_points, 0),
        dropped_double = p_game_dropped_double,
        finished_at = now()
    where id = match_row.current_game_id;
  end if;

  update public.matches
  set current_turn = null,
      white_score = coalesce(p_new_white_score, white_score),
      black_score = coalesce(p_new_black_score, black_score),
      crawford_game_number = coalesce(p_crawford_game_number, crawford_game_number),
      winner = case when match_ended then p_match_winner else winner end,
      finished_at = case when match_ended then now() else finished_at end
  where id = p_match_id;

  -- Phase 2b slice 5: when this validated turn ENDED the match, pay out on the
  -- DERIVED winner (p_match_winner came from the engine replay in the
  -- finish_turn edge fn, not from the client). Natural PvP wins now pay; the
  -- payout no longer trusts a client-asserted result.
  if match_ended then
    perform public.grant_match_reward(p_match_id, p_match_winner, false, false);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'ply', next_ply,
    'game_ended', game_ended,
    'match_ended', match_ended
  );
end;
$$;
