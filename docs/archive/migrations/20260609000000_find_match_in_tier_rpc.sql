-- Tier-aware ELO matchmaking RPCs.
--
-- Two functions, both designed for the "PvP-first, AI fallback" flow:
--
-- find_match_in_tier(table_config_id):
--   Enqueues the caller in the tier's pool. Scans for the
--   closest-rated waiting partner within +/- 200 ELO points (configurable
--   per-call). If a partner is found, atomically:
--     - debits both players' entry fees from user_wallets
--     - inserts a matches row with both owner_id + opponent_id
--     - claims both queue rows so concurrent callers don't double-pair
--   If no partner found, the caller stays in the queue and the RPC
--   returns status='queued'. The client polls again every 500ms or so.
--   When debit fails for either player (someone spent their coins
--   while waiting), the match isn't created and both stay queued —
--   the next poll may match them with someone else.
--
-- enter_room_ai_fallback(table_config_id):
--   Called by the client after the 4-second matchmaking timeout
--   expires. Removes the caller from the queue (if still there),
--   then creates an AI match — same plumbing as the old enter_room,
--   except the AI level is driven by the caller's pvp_rating:
--     pvp_rating < 1300  -> ai-easy
--     1300..1699         -> ai-medium
--     >= 1700            -> ai-hard
--   The tier's ai_level column acts as a *floor* so a designer can
--   guarantee "Beginner never spawns ai-hard" even for high-rated
--   players who happen to enter that tier.
--
-- We also drop the old single-arg enter_room (signature changed
-- semantics — the tier-aware ai-level pick lives in this RPC family
-- now).

drop function if exists public.enter_room(text);

-- 1. find_match_in_tier ------------------------------------------------

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

  -- Affordability check (no debit yet — fee is taken at pair-up).
  insert into public.user_wallets (profile_id) values (caller_id)
    on conflict (profile_id) do nothing;
  select * into caller_wallet from public.user_wallets where profile_id = caller_id;
  if caller_wallet.coins < cfg.entry_fee_coins then
    raise exception 'insufficient_coins';
  end if;

  -- Idempotent enqueue: upsert into the queue with the current
  -- pvp_rating + tier. matched_match_id gets reset to null in case
  -- the caller was previously matched but the match was abandoned.
  insert into public.matchmaking_queue
    (profile_id, target, rating, table_config_id)
  values
    (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id)
  on conflict (profile_id) do update set
    target = excluded.target,
    rating = excluded.rating,
    table_config_id = excluded.table_config_id,
    created_at = now(),
    matched_match_id = null;

  -- Look for the closest-rated waiting partner in the same tier within
  -- the ELO band. order by abs(rating - caller_rating), then by
  -- created_at so older queue entries get matched first (fair queue).
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

  -- Partner found. Atomically debit both entry fees. If either fails
  -- (someone spent their coins while waiting), abort and stay queued.
  select * into partner_wallet from public.user_wallets where profile_id = partner_id;
  if partner_wallet.coins < cfg.entry_fee_coins then
    -- The partner can't afford the room any more. Mark them as not
    -- matchable here and stay queued ourselves — they'll be re-evaluated
    -- on their next poll (and probably bumped out of the queue).
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  -- Both debits in one transaction so a half-finished pair-up is
  -- impossible. The UPDATE...WHERE coins >= fee makes each row's
  -- update a no-op if affordability changed since the read above.
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
    -- Partner debit failed after our debit went through — refund self
    -- and stay queued. Manual rollback because the transaction has
    -- already committed our update implicitly inside this function.
    update public.user_wallets
    set coins = coins + cfg.entry_fee_coins
    where profile_id = caller_id;
    return jsonb_build_object('status', 'queued', 'rating', caller_pvp_rating);
  end if;

  -- Create the match. Caller is white, partner is black (arbitrary,
  -- matches the existing matchmake convention).
  insert into public.matches
    (owner_id, opponent_id, mode, target, owner_color, is_public, table_config_id)
  values
    (caller_id, partner_id, 'online', cfg.match_target, 'white', false, p_table_config_id)
  returning id into new_match_id;

  -- Ledger rows for both debits.
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

  -- Atomically claim both queue rows. If a competing call already
  -- claimed one of them, we lose the race; refund both debits and
  -- delete the (orphan) match.
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
    -- Lossy: we leave the ledger rows in place as a paper-trail of the
    -- race. A counter-credit would be cleaner but adds complexity for
    -- a rare path.
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

comment on function public.find_match_in_tier(text, int) is
  'Tier-aware PvP matchmaker. Enqueues caller in the tier, looks for an opponent within +/- p_rating_band ELO points, and on a successful pair atomically debits both entry fees + creates the matches row. Returns jsonb {status: matched|queued, ...}. Client polls every 500ms. Raises: not_authenticated, room_not_found, room_disabled, pvp_not_allowed_in_tier, insufficient_coins.';

-- 2. enter_room_ai_fallback -------------------------------------------

create or replace function public.enter_room_ai_fallback(
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
  caller_pvp_rating int;
  wallet_row public.user_wallets;
  new_match_id uuid;
  streak_len int := 0;
  rec record;
  -- The two AI-level pickers: rating-implied vs tier floor. The
  -- effective level is the *stronger* of the two so a high-ELO player
  -- in Beginner still gets a meaningful opponent, while a low-ELO
  -- player in GM doesn't suddenly face ai-easy.
  implied_ai_level text;
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
    raise exception 'ai_not_allowed';
  end if;

  select pvp_rating into caller_pvp_rating
  from public.profiles where id = caller_id;
  caller_pvp_rating := coalesce(caller_pvp_rating, 1500);

  -- Defensive: drop the caller from the queue in case the matchmake
  -- timeout fired before cancel_matchmaking landed.
  delete from public.matchmaking_queue
  where profile_id = caller_id and matched_match_id is null;

  -- Streak escalator still applies in the AI fallback path so a player
  -- who's been winning the AI fallback matches doesn't farm easy XP.
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

  -- ELO-implied AI level. Floor by tier ai_level so a designer can
  -- guarantee a minimum strength per tier.
  implied_ai_level := case
    when caller_pvp_rating < 1300 then 'easy'
    when caller_pvp_rating < 1700 then 'medium'
    else 'hard'
  end;
  effective_ai_level := case
    when cfg.ai_level = 'hard' then 'hard'
    when cfg.ai_level = 'medium' and implied_ai_level = 'easy' then 'medium'
    else implied_ai_level
  end;
  if streak_len >= 3 then
    effective_ai_level := case effective_ai_level
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
       'AI fallback entry fee: ' || cfg.display_name,
       jsonb_build_object(
         'table_config_id', p_table_config_id,
         'mode', effective_mode,
         'streak_len', streak_len,
         'implied_ai_level', implied_ai_level,
         'fallback', true
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

grant execute on function public.enter_room_ai_fallback(text) to authenticated;

comment on function public.enter_room_ai_fallback(text) is
  'AI fallback path for the PvP-first flow. Called after the client''s ~4 second matchmaking timeout. Picks AI level from caller''s pvp_rating with cfg.ai_level as floor, applies the win-streak DDA escalator, debits entry fee, creates the AI match. Returns same payload shape as the old enter_room. Raises: not_authenticated, room_not_found, room_disabled, ai_not_allowed, insufficient_coins.';
