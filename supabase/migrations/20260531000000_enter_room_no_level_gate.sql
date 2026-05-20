-- Lift the level requirement on enter_room.
--
-- Product decision: difficulty tiers are no longer gated by
-- profile level — coin balance is the only constraint. Players can
-- attempt any tier they can afford. table_configs.required_level
-- stays as a column (it's still useful telemetry, and a future BO
-- view will surface "appropriate tier for player level" hints), but
-- enter_room no longer raises level_too_low.
--
-- Everything else in the RPC is unchanged from
-- 20260529_enter_room.sql. Listing the body in full because we
-- maintain RPCs as whole CREATE OR REPLACE blobs rather than diffs.

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
  new_match_id uuid;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

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

  if p_match_mode like 'ai-%' and not cfg.allow_ai then
    raise exception 'ai_not_allowed';
  end if;

  -- (Level check removed — tiers are open to all players. The cost is
  -- the only gate, enforced atomically below.)

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
  'Atomically enters a difficulty room. Validates table_configs row + mode, debits entry_fee_coins, creates the matches row tagged with table_config_id. Returns jsonb {match_id, turn_seconds, mode, target, wallet}. Raises: not_authenticated, unsupported_match_mode, room_not_found, room_disabled, ai_not_allowed, insufficient_coins.';
