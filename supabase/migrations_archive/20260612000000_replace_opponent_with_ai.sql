-- AI takeover for abandoned PvP matches.
--
-- When a PvP opponent goes inactive for longer than the room's
-- inactivity threshold, the remaining player's client calls this RPC.
-- It atomically:
--
--   1. Validates the caller is one of the match participants.
--   2. Validates the OTHER side hasn't moved in p_min_inactive_seconds
--      (default 30s). The caller-side client picks this threshold from
--      the room's turn_seconds + grace, so the policy is operator-tunable
--      via the Difficulties config.
--   3. Picks an AI strength from the caller's pvp_rating using the same
--      mapping enter_room_ai_fallback uses (so the simulated opponent
--      feels indistinguishable in level from the AI fallback path).
--   4. Flips match.mode from 'online' to ai-{level}. The remaining
--      client picks up this change via the existing realtime
--      subscription and switches its rendering / move-submission to
--      include AI moves for the absent side.
--   5. Stores the original opponent_id + abandoned-side flag in
--      match.current_turn metadata so finish_match knows to apply the
--      abandonment penalty when the match later finalises.
--
-- Idempotent: calling again after the mode has already flipped is a
-- no-op (returns the cached level). Race-safe: the WHERE clause on
-- the UPDATE prevents two simultaneous clients from converting twice.

create or replace function public.replace_opponent_with_ai(
  p_match_id uuid,
  p_min_inactive_seconds int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
  caller_pvp_rating int;
  abandoner_id uuid;
  inactivity_seconds int;
  implied_ai_level text;
  effective_mode text;
  rows_affected int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

  -- Caller must be one of the participants.
  if caller_id <> match_row.owner_id
     and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;
  -- Already-converted match: idempotent return.
  if match_row.mode like 'ai-%' then
    return jsonb_build_object(
      'status', 'already_converted',
      'mode', match_row.mode,
      'ai_level', substr(match_row.mode, 4)
    );
  end if;
  if match_row.mode <> 'online' or match_row.opponent_id is null then
    raise exception 'not_a_pvp_match';
  end if;

  -- Identify the abandoner = the participant that isn't the caller.
  abandoner_id := case
    when caller_id = match_row.owner_id then match_row.opponent_id
    else match_row.owner_id
  end;

  -- Inactivity check uses matches.updated_at — the same signal the
  -- client uses to drive its inactivity timer. If the abandoner has
  -- moved recently this raises and the client should keep waiting.
  inactivity_seconds := extract(epoch from (now() - match_row.updated_at))::int;
  if inactivity_seconds < greatest(p_min_inactive_seconds, 5) then
    raise exception 'opponent_still_active';
  end if;

  -- Pick AI strength from the remaining player's pvp_rating, the same
  -- mapping enter_room_ai_fallback uses so the simulated opponent
  -- feels consistent with the explicit AI fallback path.
  select pvp_rating into caller_pvp_rating
  from public.profiles where id = caller_id;
  caller_pvp_rating := coalesce(caller_pvp_rating, 1500);
  implied_ai_level := case
    when caller_pvp_rating < 1300 then 'easy'
    when caller_pvp_rating < 1700 then 'medium'
    else 'hard'
  end;
  effective_mode := 'ai-' || implied_ai_level;

  -- Atomic mode flip. The WHERE clause guards against a concurrent
  -- conversion winning the race; if rows_affected = 0 we lost it and
  -- the caller should refresh and read the new mode.
  update public.matches
  set mode = effective_mode,
      -- Stash abandonment info inside current_turn metadata, which
      -- finish_match reads to decide which side gets the zero payout.
      -- current_turn shape is the engine's own JSON; we tuck a side-
      -- channel object under the `_abandonment` key so engine code
      -- ignores it.
      current_turn = coalesce(current_turn, '{}'::jsonb)
                       || jsonb_build_object('_abandonment', jsonb_build_object(
                         'abandoner_id', abandoner_id,
                         'converted_at', now()
                       )),
      updated_at = now()
  where id = p_match_id
    and mode = 'online'
    and finished_at is null;

  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    raise exception 'race_lost';
  end if;

  return jsonb_build_object(
    'status', 'converted',
    'mode', effective_mode,
    'ai_level', implied_ai_level,
    'abandoner_id', abandoner_id,
    'inactivity_seconds', inactivity_seconds
  );
end;
$$;

grant execute on function public.replace_opponent_with_ai(uuid, int) to authenticated;

comment on function public.replace_opponent_with_ai(uuid, int) is
  'Convert an abandoned PvP match into an AI match. Validates caller is a participant, the other side has been inactive for >= p_min_inactive_seconds, then flips match.mode to ai-{level} (level picked from caller pvp_rating). Stashes abandoner_id in current_turn._abandonment for finish_match to consume. Raises: not_authenticated, match_not_found, not_match_participant, match_already_finished, not_a_pvp_match, opponent_still_active, race_lost. Returns jsonb with status, mode, ai_level, abandoner_id, inactivity_seconds.';
