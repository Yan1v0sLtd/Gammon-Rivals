-- find_match_in_tier v2: don't clobber matched_match_id on re-poll.
--
-- Bug repro (two tabs in the same browser):
--   T=0.0  Tab A polls → no partner found → row inserted with
--          matched_match_id = NULL → returns 'queued'.
--   T=0.1  Tab B polls → finds Tab A in the queue → atomically
--          debits both fees, creates the match row, claims both
--          queue rows by setting matched_match_id. Tab B's call
--          returns 'matched' and Tab B routes to /play/:id.
--   T=0.5  Tab A polls again. The previous body did
--          `on conflict (profile_id) do update set
--            ..., matched_match_id = null`
--          which RESETS the match that Tab B just claimed. Tab A
--          sees status='queued', keeps polling, and at T=4 falls
--          back to AI — even though the server-side match between
--          A and B is still live, with Tab B already in it.
--   T=4.0  Tab A on AI match in /hotseat.
--          Tab B stuck on /play/:id with no opponent ever arriving.
--
-- Fix:
--   1. Read-first. Each call starts by checking the caller's
--      existing queue row. If matched_match_id is set and that
--      match still exists + isn't finished, immediately return
--      status='matched' with that match's payload. This lets a
--      client that polls AFTER being matched still discover the
--      match instead of being re-queued.
--   2. Stop clobbering. The ON CONFLICT UPDATE list no longer
--      touches matched_match_id. created_at only refreshes when
--      the row is still unmatched, so a queued-but-matched player
--      doesn't lose their position priority on the next poll.
--
-- The two-step structure also makes the function idempotent under
-- rapid polling: calling find_match_in_tier 10 times in 5 seconds
-- against an already-matched row is now a cheap SELECT + early
-- return instead of a write-clobber-search cycle.

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

  select pvp_rating into caller_pvp_rating
  from public.profiles where id = caller_id;
  if caller_pvp_rating is null then
    raise exception 'profile_missing';
  end if;

  -- Read-first: if we're already matched (from a partner's call that
  -- ran between our last poll and this one), surface that match.
  select * into existing_queue_row
  from public.matchmaking_queue
  where profile_id = caller_id;

  if found and existing_queue_row.matched_match_id is not null then
    select * into existing_match
    from public.matches
    where id = existing_queue_row.matched_match_id;
    if found and existing_match.finished_at is null then
      select * into caller_wallet from public.user_wallets where profile_id = caller_id;
      return jsonb_build_object(
        'status', 'matched',
        'match_id', existing_match.id,
        'opponent_id',
          case when existing_match.owner_id = caller_id
               then existing_match.opponent_id
               else existing_match.owner_id
          end,
        'opponent_rating', null,
        'rating', caller_pvp_rating,
        'turn_seconds', cfg.turn_seconds,
        'target', cfg.match_target,
        'wallet', jsonb_build_object(
          'coins', coalesce(caller_wallet.coins, 0),
          'gems', coalesce(caller_wallet.gems, 0)
        )
      );
    end if;
    -- Matched to a stale/finished/missing match — fall through to
    -- the normal flow which will reset and search again.
  end if;

  insert into public.user_wallets (profile_id) values (caller_id)
    on conflict (profile_id) do nothing;
  select * into caller_wallet from public.user_wallets where profile_id = caller_id;
  if caller_wallet.coins < cfg.entry_fee_coins then
    raise exception 'insufficient_coins';
  end if;

  -- Upsert without clobbering matched_match_id. created_at only
  -- refreshes when the row is currently unmatched — preserves
  -- queueing priority for players the planner sees as "newer".
  insert into public.matchmaking_queue
    (profile_id, target, rating, table_config_id)
  values
    (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id)
  on conflict (profile_id) do update set
    target = excluded.target,
    rating = excluded.rating,
    table_config_id = excluded.table_config_id,
    created_at = case
      when matchmaking_queue.matched_match_id is null then now()
      else matchmaking_queue.created_at
    end;

  select profile_id, rating into partner_id, partner_rating
  from public.matchmaking_queue
  where profile_id <> caller_id
    and table_config_id = p_table_config_id
    and matched_match_id is null
    and abs(rating - caller_pvp_rating) <= p_rating_band
  order by abs(rating - caller_pvp_rating), created_at
  limit 1;

  if partner_id is null then
    return jsonb_build_object(
      'status', 'queued',
      'rating', caller_pvp_rating
    );
  end if;

  select * into partner_wallet from public.user_wallets where profile_id = partner_id;
  if partner_wallet.coins < cfg.entry_fee_coins then
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  update public.user_wallets
  set coins = coins - cfg.entry_fee_coins
  where profile_id = caller_id and coins >= cfg.entry_fee_coins
  returning * into caller_wallet;
  if caller_wallet.profile_id is null then
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  update public.user_wallets
  set coins = coins - cfg.entry_fee_coins
  where profile_id = partner_id and coins >= cfg.entry_fee_coins
  returning * into partner_wallet;
  if partner_wallet.profile_id is null then
    update public.user_wallets
    set coins = coins + cfg.entry_fee_coins
    where profile_id = caller_id;
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  insert into public.matches
    (owner_id, opponent_id, mode, target, owner_color, is_public, table_config_id)
  values
    (caller_id, partner_id, 'online', cfg.match_target, 'white', false, p_table_config_id)
  returning id into new_match_id;

  insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
  values
    (caller_id, 'coins', -cfg.entry_fee_coins, caller_wallet.coins, 'entry_fee',
     'PvP entry fee: ' || cfg.display_name,
     jsonb_build_object('table_config_id', p_table_config_id, 'match_id', new_match_id, 'role', 'owner'),
     caller_id),
    (partner_id, 'coins', -cfg.entry_fee_coins, partner_wallet.coins, 'entry_fee',
     'PvP entry fee: ' || cfg.display_name,
     jsonb_build_object('table_config_id', p_table_config_id, 'match_id', new_match_id, 'role', 'opponent'),
     caller_id);

  update public.matchmaking_queue
  set matched_match_id = new_match_id
  where profile_id in (caller_id, partner_id)
    and matched_match_id is null;

  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    delete from public.matches where id = new_match_id;
    update public.user_wallets
    set coins = coins + cfg.entry_fee_coins
    where profile_id in (caller_id, partner_id);
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  return jsonb_build_object(
    'status', 'matched',
    'match_id', new_match_id,
    'opponent_id', partner_id,
    'opponent_rating', partner_rating,
    'rating', caller_pvp_rating,
    'turn_seconds', cfg.turn_seconds,
    'target', cfg.match_target,
    'wallet', jsonb_build_object('coins', caller_wallet.coins, 'gems', caller_wallet.gems)
  );
end;
$$;

grant execute on function public.find_match_in_tier(text, int) to authenticated;
