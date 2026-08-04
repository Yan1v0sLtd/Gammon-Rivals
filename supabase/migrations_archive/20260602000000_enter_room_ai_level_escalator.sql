-- enter_room v3: AI level per tier + win-streak escalator.
--
-- Two behaviour changes from the previous version:
--
--   1. The match.mode is no longer fixed at 'ai-medium'. It's composed
--      from the tier's ai_level column ('ai-easy' / 'ai-medium' /
--      'ai-hard'). Operators rebalance tier strength by editing the
--      table_configs row, not by shipping code.
--
--   2. After 3 consecutive wins in the same tier (recent history,
--      ignoring older matches), the AI is silently bumped one step
--      harder for the next match (easy -> medium, medium -> hard,
--      hard stays). The bump resets on a loss. This is industry
--      Dynamic Difficulty Adjustment — it pulls the streaking player's
--      actual win rate back toward the tier's assumed p, keeping
--      RTP stable without locking anyone out.
--
-- The streak count is computed by walking the player's most recent
-- finished matches in this tier and stopping at the first loss; it's
-- O(streak_length) and only fires at room entry so the cost is bound
-- to once per match start.
--
-- We also drop the `p_match_mode` argument entirely. The caller no
-- longer chooses — the tier's ai_level is the source of truth. This is
-- the right scoping: the modal showed "Pro" not "Pro vs ai-medium",
-- and we don't want the client able to override server-side balance.

drop function if exists public.enter_room(text, text);

create or replace function public.enter_room(
  p_table_config_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  cfg public.table_configs;
  wallet_row public.user_wallets;
  new_match_id uuid;
  streak_len int := 0;
  rec record;
  effective_ai_level text;
  effective_mode text;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then
    raise exception 'room_not_found';
  end if;
  if not cfg.is_enabled then
    raise exception 'room_disabled';
  end if;
  if not cfg.allow_ai then
    -- v1 only mints AI matches via this RPC.
    raise exception 'ai_not_allowed';
  end if;

  -- Walk recent matches in this tier newest-first, counting consecutive
  -- wins until we hit a loss. Caps at 10 so the loop is bounded even
  -- for a hypothetical 100-win streak — only the first three matter
  -- for the escalator anyway.
  for rec in
    select winner = owner_color as won
    from public.matches
    where owner_id = caller_id
      and table_config_id = p_table_config_id
      and finished_at is not null
    order by finished_at desc
    limit 10
  loop
    if rec.won then
      streak_len := streak_len + 1;
    else
      exit;
    end if;
  end loop;

  -- Pick the AI strength: tier's base level, or one notch harder when
  -- the player is on a 3+ win streak. The 'hard' tier has nowhere to
  -- escalate to, so it caps.
  effective_ai_level := cfg.ai_level;
  if streak_len >= 3 then
    effective_ai_level := case cfg.ai_level
      when 'easy' then 'medium'
      when 'medium' then 'hard'
      else 'hard'
    end;
  end if;
  effective_mode := 'ai-' || effective_ai_level;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  if cfg.entry_fee_coins > 0 then
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = caller_id
      and coins >= cfg.entry_fee_coins
    returning * into wallet_row;
    if wallet_row.profile_id is null then
      raise exception 'insufficient_coins';
    end if;

    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (caller_id, 'coins', -cfg.entry_fee_coins, wallet_row.coins, 'entry_fee',
       'Entry fee: ' || cfg.display_name,
       jsonb_build_object(
         'table_config_id', p_table_config_id,
         'mode', effective_mode,
         'streak_len', streak_len,
         'escalated', effective_ai_level <> cfg.ai_level
       ),
       caller_id);
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  insert into public.matches
    (owner_id, mode, target, table_config_id)
  values
    (caller_id, effective_mode, cfg.match_target, p_table_config_id)
  returning id into new_match_id;

  return jsonb_build_object(
    'match_id', new_match_id,
    'turn_seconds', cfg.turn_seconds,
    'mode', effective_mode,
    'target', cfg.match_target,
    'ai_level', effective_ai_level,
    'streak_len', streak_len,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
  );
end;
$$;

grant execute on function public.enter_room(text) to authenticated;

comment on function public.enter_room(text) is
  'Atomically enters a difficulty room. Reads ai_level from the tier config, applies the win-streak DDA escalator (3+ consecutive wins -> one notch harder, capped at hard), debits entry_fee_coins, creates the matches row tagged with table_config_id + the effective mode. Returns jsonb {match_id, turn_seconds, mode, target, ai_level, streak_len, wallet}. Raises: not_authenticated, room_not_found, room_disabled, ai_not_allowed, insufficient_coins.';
