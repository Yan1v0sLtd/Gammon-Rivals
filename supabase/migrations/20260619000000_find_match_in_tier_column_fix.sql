-- Fix find_match_in_tier column-name regression introduced in
-- 20260616000000_enter_room_required_level.sql.
--
-- The earlier migration re-issued find_match_in_tier to add the
-- level gate, but in doing so renamed the inserts on
-- matchmaking_queue from the actual column name ("rating", set in
-- the original 0008_matchmaking.sql) to the local-variable name
-- ("pvp_rating"). matchmaking_queue has no pvp_rating column —
-- profiles does — so every queue write raised:
--   column "pvp_rating" of relation "matchmaking_queue" does not exist
--
-- The two regressed INSERTs also dropped the NOT NULL `target`
-- column, which would have failed on a second-tier deploy anyway.
--
-- This migration re-creates the function with:
--   1. The level gate preserved (the whole point of 20260616).
--   2. Queue writes addressing the real column names: target +
--      rating + table_config_id + matched_match_id + created_at.
--   3. The partner-search shape kept (it was already correct —
--      `p.pvp_rating` on the JOINed profiles row, not the queue).
--
-- Everything else from 20260616 stays the same.

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

  -- Level gate. cfg.required_level == 1 means "open to everyone";
  -- higher values gate the tier behind progression.
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

  -- Look for a partner within the rating band. `p.pvp_rating` here
  -- is the JOINed profiles row, not the queue — the queue's own
  -- snapshot of the partner's rating lives in mq.rating.
  select mq.profile_id, mq.rating into partner_id, partner_rating
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
      (profile_id, target, rating, table_config_id, created_at)
    values
      (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id, now())
    on conflict (profile_id) do update
      set target = excluded.target,
          rating = excluded.rating,
          table_config_id = excluded.table_config_id,
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
      (profile_id, target, rating, table_config_id, matched_match_id, created_at)
    values
      (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id, new_match_id, now())
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
  'PvP matchmaking inside a difficulty tier, with level gate. Read-first to recover matched state, then partner-search within rating band, then atomic two-side fee debit + match insert. Returns jsonb with status (queued / matched), optional match_id / turn_seconds / target. Raises: not_authenticated, room_not_found, room_disabled, pvp_not_allowed_in_tier, level_too_low, profile_missing, insufficient_coins, partner_insufficient_coins.';
