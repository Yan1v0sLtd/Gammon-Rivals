-- Lobby profile stats RPC — one round-trip for the three stats shown
-- on the new premium profile card in the lobby top-bar:
--
--   highest_win   — largest single coin reward the player ever
--                   collected from a finished match. Sourced from
--                   wallet_transactions where source='match_reward'
--                   so AI risk-free refunds and PvP rake-aware
--                   payouts are both counted automatically.
--   streak_days   — current_streak_days from player_streak (the
--                   daily-missions streak counter). This is the
--                   long-running consecutive-days number; the
--                   user_daily_bonuses table tracks position in
--                   the 7-day recursive bonus cycle, which is a
--                   different concept.
--   win_rate_pct  — wins as a percentage of total finished matches
--                   in which the player participated (owner OR
--                   opponent). For AI matches the player is always
--                   the owner; for PvP either side wins when their
--                   colour matches the match's `winner` column.
--   wins / total_finished — raw numerators returned alongside the
--                   percentage so the client can show "12W of 20"
--                   if it ever wants to.
--
-- The RPC is `stable security definer` so RLS doesn't get in the
-- way (matches/wallet_transactions have player-scoped policies but
-- we want the player's own stats; the function authenticates via
-- auth.uid()).

create or replace function public.get_player_lobby_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  highest_win int := 0;
  streak_days int := 0;
  wins int := 0;
  total_finished int := 0;
  win_rate int := 0;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(max(amount), 0) into highest_win
  from public.wallet_transactions
  where profile_id = me
    and currency = 'coins'
    and source = 'match_reward'
    and amount > 0;

  select coalesce(current_streak_days, 0) into streak_days
  from public.player_streak
  where profile_id = me;
  streak_days := coalesce(streak_days, 0);

  -- Wins + total — owner-side OR opponent-side. owner_color is the
  -- match's record of which colour the owner played; the winner
  -- column is 'white' / 'black' / null. A player wins when their
  -- side equals the winner colour.
  select
    count(*) filter (
      where (owner_id = me and winner = owner_color)
         or (opponent_id = me and winner is not null and winner <> owner_color)
    ),
    count(*)
  into wins, total_finished
  from public.matches
  where finished_at is not null
    and (owner_id = me or opponent_id = me);

  if total_finished > 0 then
    win_rate := round((wins::numeric / total_finished) * 100)::int;
  end if;

  return jsonb_build_object(
    'highest_win', highest_win,
    'streak_days', streak_days,
    'wins', wins,
    'total_finished', total_finished,
    'win_rate_pct', win_rate
  );
end;
$$;

grant execute on function public.get_player_lobby_stats() to authenticated;

comment on function public.get_player_lobby_stats() is
  'Returns the three stats shown on the new lobby profile card: highest single match-reward payout, current daily-missions streak days, and overall win rate (AI + PvP combined). One round-trip; auth.uid() scopes the result to the calling player.';
