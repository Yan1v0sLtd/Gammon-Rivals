-- Match-end XP + coin reward grant.
--
-- finish_match() is the server-side counterpart to the client's old
-- "UPDATE matches SET finished_at, winner..." call. It:
--   1. Validates ownership (caller_id == match.owner_id) so a client
--      can't finalise someone else's match.
--   2. Refuses to re-finalise an already-finished match (idempotency
--      protects against double-rewards on network retries).
--   3. Writes the final score / winner / finished_at to the match row.
--   4. If the match was started via a difficulty room
--      (table_config_id is not null) AND the caller's color won,
--      grants prize_coins + (base_xp_win * xp_multiplier_pct / 100)
--      base XP, scaled by the player's active user_xp_boosts buff via
--      current_xp_multiplier(). Each currency move logs a
--      wallet_transactions row with source='match_reward'.
--
-- Why server-side: keeps the entry-fee economy honest. Without this,
-- a client could call the old UPDATE with winner='white' and farm
-- rewards. (We still trust the client for the *value* of the winner
-- in v1 — full game-state validation against the engine is out of
-- scope. For now the table_config_id constraint means only
-- difficulty-room matches enter this code path; legacy hot-seat /
-- online matches outside the modal still go through the plain
-- UPDATE in persistence.finishMatch and skip the reward.)

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

  -- Default response shape; populated below only when a difficulty room
  -- actually awards something.
  xp_awarded := 0;
  coins_awarded := 0;
  xp_mult := 1;
  owner_won := (p_winner is not null and p_winner = match_row.owner_color);

  if match_row.table_config_id is not null and owner_won then
    select * into cfg from public.table_configs where id = match_row.table_config_id;
    if found then
      -- XP grant: room base × room multiplier × active user boost. Floor
      -- the multiplication by integer math; we keep values small
      -- enough that overflow isn't a concern.
      xp_mult := public.current_xp_multiplier(caller_id);
      xp_awarded := (cfg.base_xp_win * cfg.xp_multiplier_pct / 100) * xp_mult;
      coins_awarded := cfg.prize_coins;

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
           'Match reward: ' || cfg.display_name,
           jsonb_build_object('match_id', p_match_id, 'table_config_id', cfg.id),
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
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$$;

grant execute on function public.finish_match(uuid, int, int, text, int) to authenticated;

comment on function public.finish_match(uuid, int, int, text, int) is
  'Atomic match completion. Validates caller is match owner, sets winner/finished_at, and (if the match has a table_config_id and the owner won) grants base_xp_win*xp_multiplier_pct/100 scaled by current_xp_multiplier() + prize_coins. Idempotent (raises match_already_finished). Returns jsonb {match_id, owner_won, xp_awarded, xp_multiplier, coins_awarded, wallet, profile}.';
