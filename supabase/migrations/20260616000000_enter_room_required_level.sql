-- Re-enable the level gate on difficulty rooms.
--
-- Product reversal of 20260531_enter_room_no_level_gate.sql. The
-- table_configs.required_level column was kept around as telemetry
-- when level-gating was previously dropped; we now bring it back as
-- the actual unlock gate. Each tier's value is configurable in the
-- Back Office Difficulties section, so live ops can re-tune which
-- level opens which tier without a schema change.
--
-- Both server entry points to a difficulty room enforce the same
-- check so URL-hacks can't bypass the modal UI:
--   * enter_room — used by the AI / hot-seat path.
--   * find_match_in_tier — used by the PvP path.
--
-- Both raise the same error code (`level_too_low`) so the client can
-- show a single fallback toast. The modal itself reads
-- table_configs.required_level + profiles.level and renders the gray
-- "Unlocks at Level N" button before the player ever clicks Play, so
-- this server check is the defence-in-depth, not the primary UX.

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
  caller_level int;
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

  -- Level gate. cfg.required_level == 1 means "open to everyone";
  -- higher values gate the tier behind progression.
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level, 1) < cfg.required_level then
      raise exception 'level_too_low';
    end if;
  end if;

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
  'Atomically enters a difficulty room. Validates table_configs row + mode, checks profile level against required_level, debits entry_fee_coins, creates the matches row tagged with table_config_id. Returns jsonb {match_id, turn_seconds, mode, target, wallet}. Raises: not_authenticated, unsupported_match_mode, room_not_found, room_disabled, ai_not_allowed, level_too_low, insufficient_coins.';

-- Mirror the level check in the PvP entry path. find_match_in_tier's
-- body is long; we re-issue the whole CREATE OR REPLACE so the level
-- check is in plain sight at the top of the function, right next to
-- the room_disabled / pvp_not_allowed_in_tier checks.

create or replace function public.find_match_in_tier(
  p_table_config_id text,
  p_rating_band int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  caller_level int;
  cfg public.table_configs;
  caller_pvp_rating int;
  partner_id uuid;
  partner_rating int;
  new_match_id uuid;
  rows_updated int;
  caller_wallet public.user_wallets;
  partner_wallet public.user_wallets;
  existing_queue_row public.matchmaking_queue;
  existing_match public.matches;
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
  if not cfg.allow_online_pvp then
    raise exception 'pvp_not_allowed_in_tier';
  end if;

  -- Level gate.
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level, 1) < cfg.required_level then
      raise exception 'level_too_low';
    end if;
  end if;

  select pvp_rating into caller_pvp_rating
  from public.profiles where id = caller_id;
  if caller_pvp_rating is null then
    raise exception 'profile_missing';
  end if;

  -- Read-first: if we're already matched (from a partner's call that
  -- already paired us in a previous tick) just return the match.
  select * into existing_queue_row from public.matchmaking_queue
    where profile_id = caller_id;
  if found and existing_queue_row.matched_match_id is not null then
    select * into existing_match from public.matches
      where id = existing_queue_row.matched_match_id;
    if found and existing_match.finished_at is null then
      return jsonb_build_object(
        'status', 'matched',
        'match_id', existing_match.id,
        'turn_seconds', cfg.turn_seconds,
        'target', cfg.match_target
      );
    end if;
  end if;

  -- Look for a partner within the rating band.
  select profile_id, pvp_rating into partner_id, partner_rating
  from public.matchmaking_queue mq
  join public.profiles p on p.id = mq.profile_id
  where mq.table_config_id = p_table_config_id
    and mq.profile_id <> caller_id
    and mq.matched_match_id is null
    and abs(p.pvp_rating - caller_pvp_rating) <= p_rating_band
  order by mq.created_at asc
  limit 1
  for update skip locked;

  if partner_id is null then
    -- No partner — enqueue (or refresh row if not already matched).
    insert into public.matchmaking_queue
      (profile_id, table_config_id, pvp_rating, created_at)
    values
      (caller_id, p_table_config_id, caller_pvp_rating, now())
    on conflict (profile_id) do update
      set table_config_id = excluded.table_config_id,
          pvp_rating = excluded.pvp_rating,
          created_at = case
            when public.matchmaking_queue.matched_match_id is null then now()
            else public.matchmaking_queue.created_at
          end;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Partner found. Debit both fees atomically; create the match row.
  insert into public.user_wallets (profile_id) values (caller_id)
    on conflict (profile_id) do nothing;
  insert into public.user_wallets (profile_id) values (partner_id)
    on conflict (profile_id) do nothing;

  if cfg.entry_fee_coins > 0 then
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = caller_id and coins >= cfg.entry_fee_coins
    returning * into caller_wallet;
    if caller_wallet.profile_id is null then
      raise exception 'insufficient_coins';
    end if;

    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = partner_id and coins >= cfg.entry_fee_coins
    returning * into partner_wallet;
    if partner_wallet.profile_id is null then
      -- Refund caller — partner can't afford after all.
      update public.user_wallets
        set coins = coins + cfg.entry_fee_coins
        where profile_id = caller_id;
      raise exception 'partner_insufficient_coins';
    end if;

    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (caller_id, 'coins', -cfg.entry_fee_coins, caller_wallet.coins, 'entry_fee',
        'PvP entry fee: ' || cfg.display_name,
        jsonb_build_object('table_config_id', p_table_config_id, 'mode', 'online'),
        caller_id),
      (partner_id, 'coins', -cfg.entry_fee_coins, partner_wallet.coins, 'entry_fee',
        'PvP entry fee: ' || cfg.display_name,
        jsonb_build_object('table_config_id', p_table_config_id, 'mode', 'online'),
        partner_id);
  end if;

  insert into public.matches
    (owner_id, opponent_id, mode, target, table_config_id, owner_color)
  values
    (caller_id, partner_id, 'online', cfg.match_target, p_table_config_id, 'white')
  returning id into new_match_id;

  -- Claim BOTH queue rows so a parallel poll doesn't re-queue.
  update public.matchmaking_queue
    set matched_match_id = new_match_id
    where profile_id in (caller_id, partner_id);
  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    -- One side wasn't in the queue at all; defensive insert for the
    -- caller so a subsequent poll can find the match.
    insert into public.matchmaking_queue
      (profile_id, table_config_id, pvp_rating, matched_match_id, created_at)
    values
      (caller_id, p_table_config_id, caller_pvp_rating, new_match_id, now())
    on conflict (profile_id) do update
      set matched_match_id = excluded.matched_match_id;
  end if;

  return jsonb_build_object(
    'status', 'matched',
    'match_id', new_match_id,
    'turn_seconds', cfg.turn_seconds,
    'target', cfg.match_target
  );
end;
$$;

grant execute on function public.find_match_in_tier(text, int) to authenticated;

comment on function public.find_match_in_tier(text, int) is
  'PvP matchmaking inside a difficulty tier. Read-first to recover matched state, then partner-search within rating band, then atomic two-side fee debit + match insert. Returns jsonb with status (queued / matched), optional match_id / turn_seconds / target. Raises: not_authenticated, room_not_found, room_disabled, pvp_not_allowed_in_tier, level_too_low, profile_missing, insufficient_coins, partner_insufficient_coins.';
