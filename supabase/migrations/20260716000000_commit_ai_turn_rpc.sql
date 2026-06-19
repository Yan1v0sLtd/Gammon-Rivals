-- Phase 2b layer 2 — atomic write of a SERVER-AUTHORED AI turn.
--
-- The ai_move edge function (service role) reconstructs the board, rolls the
-- bot's dice server-side, picks the bot's move via the shared AI mirror
-- (_shared/ai), derives the outcome, and calls this function to commit it.
--
-- It mirrors commit_turn_server (slice 3) but for the bot:
--   * the mover is the colour OPPOSITE the human owner (the bot has no caller /
--     user row), so there is no caller-active-player check — the edge function
--     already verified, via replay, that it is the bot's turn;
--   * it only operates on AI matches (mode like 'ai-%');
--   * on match-end it pays out via grant_match_reward (slice 5), so a
--     server-driven AI match is settled server-authoritatively;
--   * service_role ONLY — the bot's move can never originate from a client.
--
-- Dormant until the AI match flow is routed through ai_move (a later slice).

create or replace function public.commit_ai_turn(
  p_match_id uuid,
  p_dice int[],
  p_sub_moves jsonb,
  p_game_winner text default null,
  p_game_win_type text default null,
  p_game_points int default null,
  p_new_white_score int default null,
  p_new_black_score int default null,
  p_match_winner text default null,
  p_crawford_game_number int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  match_row public.matches;
  bot_color text;
  next_ply int;
  game_ended boolean := p_game_winner is not null;
  match_ended boolean := p_match_winner is not null;
begin
  select * into match_row from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if match_row.mode is null or match_row.mode not like 'ai-%' then
    raise exception 'not_ai_match';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;
  if match_row.current_game_id is null then
    raise exception 'no_current_game';
  end if;

  -- In an AI match the bot plays the colour opposite the human owner.
  bot_color := case
    when coalesce(match_row.owner_color, 'white') = 'white' then 'black'
    else 'white'
  end;

  select coalesce(max(ply), -1) + 1 into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (
    match_row.current_game_id,
    next_ply,
    bot_color,
    p_dice,
    coalesce(p_sub_moves, '[]'::jsonb),
    null
  );

  if game_ended then
    update public.games
    set winner = p_game_winner,
        win_type = p_game_win_type,
        cube_value = match_row.cube_value,
        cube_owner = match_row.cube_owner,
        points_awarded = coalesce(p_game_points, 0),
        dropped_double = false,
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

  if match_ended then
    perform public.grant_match_reward(p_match_id, p_match_winner, false, false);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'ply', next_ply,
    'bot_color', bot_color,
    'game_ended', game_ended,
    'match_ended', match_ended
  );
end;
$$;

revoke execute on function public.commit_ai_turn(uuid, int[], jsonb, text, text, int, int, int, text, int) from public, anon, authenticated;
grant execute on function public.commit_ai_turn(uuid, int[], jsonb, text, text, int, int, int, text, int) to service_role;

comment on function public.commit_ai_turn(uuid, int[], jsonb, text, text, int, int, int, text, int) is
  'Phase 2b layer 2: atomic write of a server-authored AI turn. Called only by the ai_move edge function (service role) after it replays the board, rolls the bot dice, picks the bot move via the shared AI, and derives the outcome. Mover = colour opposite the human owner; AI matches only (mode like ai-%); pays via grant_match_reward on match-end. service_role only.';
