-- Phase 2b layer 2 slice 2a — bot-opponent support on the online match path.
--
-- Approach A: a vs-AI match is an ONLINE match (mode='online') whose opponent is
-- a server bot. opponent_id stays NULL; is_bot marks it and bot_level carries the
-- difficulty. The online infra (roll_dice / commit_turn_server / finish_turn)
-- drives the human's turns, and ai_move + commit_ai_turn drive the bot's — so the
-- whole match is server-authoritative and indistinguishable from a human online
-- match.
--
-- Additive + dormant: existing matches default is_bot=false (unchanged). Nothing
-- creates a bot match until the client reroute (slice 2b).

alter table public.matches
  add column if not exists is_bot boolean not null default false,
  add column if not exists bot_level text;

comment on column public.matches.is_bot is
  'Phase 2b layer 2: true for an online match whose opponent is a server bot (opponent_id stays null). roll_dice accepts it; ai_move / commit_ai_turn drive the bot side.';
comment on column public.matches.bot_level is
  'AI difficulty for a bot match (easy/medium/hard); null for human matches.';

-- Re-key commit_ai_turn off is_bot (bot matches are mode=online now, not ai-%).
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
  if not found then raise exception 'match_not_found'; end if;
  if not coalesce(match_row.is_bot, false) then raise exception 'not_bot_match'; end if;
  if match_row.finished_at is not null then raise exception 'match_already_finished'; end if;
  if match_row.current_game_id is null then raise exception 'no_current_game'; end if;

  bot_color := case when coalesce(match_row.owner_color, 'white') = 'white' then 'black' else 'white' end;

  select coalesce(max(ply), -1) + 1 into next_ply from public.moves where game_id = match_row.current_game_id;

  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (match_row.current_game_id, next_ply, bot_color, p_dice, coalesce(p_sub_moves, '[]'::jsonb), null);

  if game_ended then
    update public.games
    set winner = p_game_winner, win_type = p_game_win_type, cube_value = match_row.cube_value,
        cube_owner = match_row.cube_owner, points_awarded = coalesce(p_game_points, 0),
        dropped_double = false, finished_at = now()
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

  return jsonb_build_object('status','ok','ply',next_ply,'bot_color',bot_color,'game_ended',game_ended,'match_ended',match_ended);
end;
$$;

revoke execute on function public.commit_ai_turn(uuid, int[], jsonb, text, text, int, int, int, text, int) from public, anon, authenticated;
grant execute on function public.commit_ai_turn(uuid, int[], jsonb, text, text, int, int, int, text, int) to service_role;
