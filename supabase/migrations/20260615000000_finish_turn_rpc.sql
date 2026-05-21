-- Atomic end-of-turn RPC.
--
-- The client-side endTurn used to do three separate writes:
--   1. INSERT into moves
--   2. UPDATE games (if the game ended this turn)
--   3. UPDATE matches.current_turn = null (+ score / crawford / match
--      finished_at if relevant)
--
-- Each of those writes fired its own Realtime event and committed
-- independently. The opponent's client could refresh between (1) and
-- (3) and see a state where the new moves row was already inserted
-- but match.current_turn still held the same submoves. deriveState
-- then applied those submoves twice — once from the moves row, once
-- from current_turn — and the engine threw "no white checker at
-- point X" because the source was already empty after the first
-- application. That throw either crashed the render (RouteErrorBoundary
-- caught it) or, after we added a try/catch in deriveState, reset to
-- initialBoard mid-game. Either way the opponent saw a broken board.
--
-- This RPC collapses the three writes into one transaction so the
-- intermediate state never exists. Either the opponent sees the old
-- match.current_turn + no new moves row, or the new moves row + a
-- cleared match.current_turn. Never the contradictory combination.
--
-- The engine math (who won the game, what win type, how many points)
-- is still computed client-side and passed in — porting computeBearOff
-- + Crawford detection to plpgsql is impractical and there's no
-- anti-cheat threat model here that justifies it. The RPC focuses on
-- atomicity, which is the actual bug.

create or replace function public.finish_turn(
  p_match_id uuid,
  p_game_winner text default null,           -- 'white' / 'black' if game ended, else null
  p_game_win_type text default null,         -- 'single' / 'gammon' / 'backgammon'
  p_game_points int default null,            -- points awarded this game (after cube)
  p_game_dropped_double boolean default false,
  p_new_white_score int default null,        -- match white score AFTER this game
  p_new_black_score int default null,        -- match black score AFTER this game
  p_match_winner text default null,          -- 'white' / 'black' if match ended, else null
  p_crawford_game_number int default null,   -- Crawford game number after this turn
  p_elapsed_ms int default null              -- think-time telemetry
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
  ct jsonb;
  ct_player text;
  caller_color text;
  next_ply int;
  game_ended boolean := p_game_winner is not null;
  match_ended boolean := p_match_winner is not null;
  dice_a int;
  dice_b int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Lock the match row for the duration of this transaction so a
  -- concurrent finish_turn / replace_opponent_with_ai / finish_match
  -- can't race us through.
  select * into match_row from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  if caller_id <> match_row.owner_id
     and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
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

  -- Caller must be the active player. owner_color defines who owns
  -- white; the opposite is who owns black.
  if caller_id = match_row.owner_id then
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

  -- Pull dice out of the JSONB. dice is stored as a 2-element JSON
  -- array, but the moves table expects an int[] Postgres array.
  dice_a := (ct -> 'dice' ->> 0)::int;
  dice_b := (ct -> 'dice' ->> 1)::int;

  -- Compute next ply (race-safe because we hold the row lock).
  select coalesce(max(ply), -1) + 1 into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  -- 1. INSERT the moves row.
  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (
    match_row.current_game_id,
    next_ply,
    ct_player,
    array[dice_a, dice_b],
    coalesce(ct -> 'subMoves', '[]'::jsonb),
    p_elapsed_ms
  );

  -- 2. UPDATE games if the game ended this turn.
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

  -- 3. UPDATE matches.current_turn (+ scores / crawford / match-end
  -- if applicable). Single statement; the previous version did
  -- different SQL depending on whether match_ended, but coalesce()
  -- lets one statement handle every case.
  update public.matches
  set current_turn = null,
      white_score = coalesce(p_new_white_score, white_score),
      black_score = coalesce(p_new_black_score, black_score),
      crawford_game_number = coalesce(p_crawford_game_number, crawford_game_number),
      winner = case when match_ended then p_match_winner else winner end,
      finished_at = case when match_ended then now() else finished_at end
  where id = p_match_id;

  return jsonb_build_object(
    'status', 'ok',
    'ply', next_ply,
    'game_ended', game_ended,
    'match_ended', match_ended
  );
end;
$$;

grant execute on function public.finish_turn(uuid, text, text, int, boolean, int, int, text, int, int) to authenticated;

comment on function public.finish_turn(uuid, text, text, int, boolean, int, int, text, int, int) is
  'Atomic end-of-turn: INSERT moves row + optional UPDATE games (game ended) + UPDATE matches.current_turn=null (with score/crawford/match-end fields). Single transaction, single row lock on matches. Replaces the three-step client sequence whose intermediate state caused the opponent to apply submoves twice and crash applyMove with "no checker at point X". Caller must be a match participant and the active player. Raises: not_authenticated, match_not_found, not_match_participant, match_already_finished, no_turn_in_progress, malformed_current_turn, not_your_turn, no_current_game. Returns jsonb {status, ply, game_ended, match_ended}.';
