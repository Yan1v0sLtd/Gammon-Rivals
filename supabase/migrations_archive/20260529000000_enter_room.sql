-- Atomic "enter room" flow for the new lobby difficulty modal.
--
-- The player picks a difficulty tier in the modal, the client calls
-- enter_room(table_config_id, mode). The RPC:
--   1. Validates the tier exists, is enabled, and allows the chosen mode
--   2. Gates by required_level
--   3. Debits entry_fee_coins atomically (no debit happens if any
--      precondition fails — typed exception bubbles up to the modal)
--   4. Inserts a matches row with table_config_id set so HotSeat /
--      match-end RPCs can resolve turn_seconds / xp_multiplier / etc.
--      from the room config
--   5. Returns the match id and the resolved turn_seconds so the client
--      doesn't need a follow-up read before navigating into the match
--
-- v1 scope: AI matches only (hotseat / ai-easy / ai-medium / ai-hard).
-- Online support comes once we wire opponent-side payment + matchmaking
-- through the same room config. Until then, the existing public-lobby
-- and invite-code flows continue to work unchanged.

-- 1. Allow 'entry_fee' as a wallet_transactions.source value so the
--    ledger row inserted below is queryable as a distinct kind of debit
--    (separate from purchase / refund).
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_source_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_source_check
  check (source in (
    'admin_adjustment', 'match_reward', 'purchase', 'daily_bonus',
    'level_reward', 'refund', 'system', 'entry_fee'
  ));

-- 2. The RPC itself.
create or replace function public.enter_room(
  p_table_config_id text,
  p_match_mode text default 'ai-medium'
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
  player_level int;
  new_match_id uuid;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- v1 only mints AI / hotseat matches via this RPC. Once online is
  -- wired through the modal, expand this whitelist and branch the
  -- insert below to populate invite_code / invite_expires_at.
  if p_match_mode not in ('hotseat', 'ai-easy', 'ai-medium', 'ai-hard') then
    raise exception 'unsupported_match_mode';
  end if;

  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then
    raise exception 'room_not_found';
  end if;
  if not cfg.is_enabled then
    raise exception 'room_disabled';
  end if;

  -- Mode permitted by the room config. allow_ai gates ai-* and hotseat
  -- (hotseat is a local two-player match, but we treat it as "AI is
  -- allowed" for v1 since both share the offline-friendly profile).
  if p_match_mode like 'ai-%' and not cfg.allow_ai then
    raise exception 'ai_not_allowed';
  end if;

  select level into player_level from public.profiles where id = caller_id;
  if coalesce(player_level, 1) < cfg.required_level then
    raise exception 'level_too_low';
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  -- Atomic debit. The guard `coins >= entry_fee_coins` makes the
  -- UPDATE a no-op (returns 0 rows) when the player can't afford
  -- the tier — we detect that and raise instead of proceeding.
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
       jsonb_build_object('table_config_id', p_table_config_id, 'mode', p_match_mode),
       caller_id);
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  insert into public.matches
    (owner_id, mode, target, table_config_id)
  values
    (caller_id, p_match_mode, cfg.match_target, p_table_config_id)
  returning id into new_match_id;

  return jsonb_build_object(
    'match_id', new_match_id,
    'turn_seconds', cfg.turn_seconds,
    'mode', p_match_mode,
    'target', cfg.match_target,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
  );
end;
$$;

grant execute on function public.enter_room(text, text) to authenticated;

comment on function public.enter_room(text, text) is
  'Atomically enters a difficulty room. Validates table_configs row + mode + level + coins, debits entry_fee_coins, creates the matches row tagged with table_config_id. Returns jsonb {match_id, turn_seconds, mode, target, wallet}. Raises: not_authenticated, unsupported_match_mode, room_not_found, room_disabled, ai_not_allowed, level_too_low, insufficient_coins.';
