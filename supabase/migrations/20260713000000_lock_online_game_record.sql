-- Phase 2b slice 4 — lock the ONLINE (PvP) game record to server-only writers.
--
-- The whole game record (moves, games, matches) was client-writable: any match
-- participant could INSERT moves / set a game's winner directly via REST,
-- bypassing the validated server path. That makes slice 3's turn validation and
-- slice 5's finish_match-derive meaningless — a cheater could just forge the
-- record. (matches RLS: matches_update_own_or_opponent; moves/games:
-- moves_insert_via_game, games_insert_via_match, games_update_via_match.)
--
-- This restricts client INSERT/UPDATE on moves + games to NON-online matches.
-- Online (PvP) games/moves can then be written ONLY by the server: the
-- commit_turn_server RPC (security definer, slice 3) and the roll_dice edge fn
-- (service role, slice 4).
--
-- AI/hotseat matches keep client writes (HotSeat.saveGame) for now: their moves
-- are client-authored regardless, so locking them adds no integrity until
-- layer 2 makes AI moves server-authored — at which point this widens to all
-- modes. Deliberately NOT touching the live AI economy here.
--
-- matches outcome columns (winner / scores) are left for a later integrity
-- pass: slice 5 derives payout from the now-locked online MOVES, not from
-- matches.winner, so forging matches.winner cannot mint coins (finish_match
-- rejects an already-finished match, so a direct winner-write can't be cashed).
--
-- Also revokes the old finish_turn RPC grant — the PvP turn-commit path is now
-- exclusively the validated finish_turn edge fn (slice 3).

-- moves: client INSERT only for non-online matches. (No UPDATE/DELETE policy
-- exists, so client UPDATE/DELETE on moves is already denied under RLS.)
drop policy if exists moves_insert_via_game on public.moves;
create policy moves_insert_via_game on public.moves
  for insert to public
  with check (
    game_id in (
      select g.id
      from public.games g
      join public.matches m on g.match_id = m.id
      where (m.owner_id = auth.uid() or m.opponent_id = auth.uid())
        and m.mode <> 'online'
    )
  );

-- games: client INSERT + UPDATE only for non-online matches.
drop policy if exists games_insert_via_match on public.games;
create policy games_insert_via_match on public.games
  for insert to public
  with check (
    match_id in (
      select m.id
      from public.matches m
      where (m.owner_id = auth.uid() or m.opponent_id = auth.uid())
        and m.mode <> 'online'
    )
  );

drop policy if exists games_update_via_match on public.games;
create policy games_update_via_match on public.games
  for update to public
  using (
    match_id in (
      select m.id
      from public.matches m
      where (m.owner_id = auth.uid() or m.opponent_id = auth.uid())
        and m.mode <> 'online'
    )
  );

-- Close the slice-3 bypass: the old client-callable finish_turn RPC trusted
-- client outcome fields. The validated finish_turn edge fn replaced it.
revoke execute on function public.finish_turn(uuid, text, text, int, boolean, int, int, text, int, int) from authenticated, anon, public;
