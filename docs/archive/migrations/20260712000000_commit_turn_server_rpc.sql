-- Phase 2b slice 3 — server-authoritative turn commit (atomic-write half).
--
-- Background. finish_turn (20260615000000) made end-of-turn ATOMIC — one
-- transaction: INSERT moves + optional UPDATE games + UPDATE matches — but it
-- explicitly TRUSTED the client's claimed game outcome (winner / win type /
-- points / scores / match winner / crawford). Its own header said: "there's no
-- anti-cheat threat model here that justifies [server derivation]". There now
-- is one: the difficulty tiers are a live coin economy and the recorded result
-- drives payout, so a client that finishes a turn (or match) with a fabricated
-- winner mints coins (security audit P0 — coin-minting).
--
-- We can't port the engine (move legality + bear-off classification + Crawford)
-- to plpgsql: it's the single source of truth in src/engine (TypeScript). So the
-- NEW move-commit path is:
--
--   client → finish_turn EDGE FN (Deno; bundles the shared engine mirror) →
--     replays the game's recorded moves + this turn's submoves, validates every
--     sub-move against legalMoves, DERIVES the true outcome, then calls THIS
--     function (under the service role) with the derived values + the validated
--     submoves.
--
-- This function is the atomic-write half. It is identical in spirit to
-- finish_turn, but:
--   (a) it takes p_caller_id instead of auth.uid() — it is invoked by the edge
--       function under the service role, which has already authenticated the
--       caller via its JWT;
--   (b) it inserts the exact p_dice / p_sub_moves the edge fn validated (not
--       whatever current_turn happens to hold at lock time), so the recorded
--       move row always replays to the recorded outcome;
--   (c) it is granted to service_role ONLY — no client (anon or authenticated)
--       can call it, so the "already validated / already derived" values can
--       never originate from a client.
--
-- finish_turn (the old client-callable RPC) is left in place as a rollback path;
-- slice 4 revokes its 'authenticated' grant once this path is proven in prod.

create or replace function public.commit_turn_server(
  p_match_id uuid,
  p_caller_id uuid,
  p_dice int[],
  p_sub_moves jsonb,
  p_game_winner text default null,           -- 'white' / 'black' if game ended, derived
  p_game_win_type text default null,         -- 'single' / 'gammon' / 'backgammon', derived
  p_game_points int default null,            -- points awarded this game (after cube), derived
  p_game_dropped_double boolean default false,
  p_new_white_score int default null,        -- match white score AFTER this game, derived
  p_new_black_score int default null,        -- match black score AFTER this game, derived
  p_match_winner text default null,          -- 'white' / 'black' if match ended, derived
  p_crawford_game_number int default null,   -- Crawford game number after this turn, derived
  p_elapsed_ms int default null              -- think-time telemetry
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

  -- Lock the match row for the transaction so a concurrent commit_turn_server /
  -- finish_turn / replace_opponent_with_ai / finish_match can't race us through.
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

  -- Caller must be the active player. owner_color defines who owns white; the
  -- opposite is who owns black.
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

  -- Compute next ply (race-safe under the row lock).
  select coalesce(max(ply), -1) + 1 into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  -- 1. INSERT the moves row — using the dice + submoves the edge fn validated,
  --    so the recorded game always replays back to the recorded outcome.
  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (
    match_row.current_game_id,
    next_ply,
    ct_player,
    p_dice,
    coalesce(p_sub_moves, '[]'::jsonb),
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

  -- 3. UPDATE matches.current_turn (+ scores / crawford / match-end).
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

-- Service-role ONLY. The edge function (which has authenticated the caller and
-- derived the outcome from the replayed engine) is the sole legitimate caller.
-- Revoke the default PUBLIC grant so no client can call it with hand-supplied
-- "already validated" values.
revoke execute on function public.commit_turn_server(uuid, uuid, int[], jsonb, text, text, int, boolean, int, int, text, int, int) from public, anon, authenticated;
grant execute on function public.commit_turn_server(uuid, uuid, int[], jsonb, text, text, int, boolean, int, int, text, int, int) to service_role;

comment on function public.commit_turn_server(uuid, uuid, int[], jsonb, text, text, int, boolean, int, int, text, int, int) is
  'Phase 2b: atomic-write half of the server-authoritative turn commit. Called ONLY by the finish_turn edge function (service role) after it has replayed + validated the turn through the shared engine and derived the true outcome. Mirrors finish_turn''s atomic 3-write (INSERT moves + optional UPDATE games + UPDATE matches) but takes p_caller_id (the edge fn already authenticated the caller) and inserts the exact validated p_dice/p_sub_moves. Granted to service_role only. Raises: not_authenticated, match_not_found, not_match_participant, match_already_finished, no_turn_in_progress, malformed_current_turn, not_your_turn, no_current_game.';
