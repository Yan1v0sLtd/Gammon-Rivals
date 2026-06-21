-- Randomize who opens an ONLINE match (PvP + server-bot), so it's not always
-- the match owner.
--
-- White always opens (the engine + every board replay start white-first), and
-- the client is fully colour-symmetric — localColor / seat mapping / the intro
-- banner all derive from owner_color + opponent_id. So randomizing owner_color
-- at creation randomizes the opener with ZERO client/engine changes. Reward
-- attribution is unaffected: grant_match_reward computes owner_won := (winner =
-- owner_color), which stays correct whichever colour the owner is.
--
--   * find_match_in_tier (PvP): owner colour is now a coin-flip.
--   * enter_room_ai_fallback: randomized ONLY for the server-bot (online) case.
--     The legacy HotSeat path (mode='ai-%') keeps owner_color='white' because
--     HotSeat plays the human as white and attributes rewards on that basis
--     (its opener is already randomized client-side via randomFirstBoard).
--
-- HotSeat (vs-AI, client-side) already randomizes its opener in useGame and is
-- not touched here.

-- ── PvP matchmaker ────────────────────────────────────────────────────────
create or replace function public.find_match_in_tier(p_table_config_id text, p_rating_band integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then raise exception 'room_not_found'; end if;
  if not cfg.is_enabled then raise exception 'room_disabled'; end if;
  if not cfg.allow_online_pvp then raise exception 'pvp_not_allowed_in_tier'; end if;
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level,1) < cfg.required_level then raise exception 'level_too_low'; end if;
  end if;
  select pvp_rating into caller_pvp_rating from public.profiles where id = caller_id;
  if caller_pvp_rating is null then raise exception 'profile_missing'; end if;
  select * into existing_queue_row from public.matchmaking_queue where profile_id = caller_id;
  if found and existing_queue_row.matched_match_id is not null then
    select * into existing_match from public.matches where id = existing_queue_row.matched_match_id;
    if found and existing_match.finished_at is null then
      return jsonb_build_object('status','matched','match_id',existing_match.id,'turn_seconds',cfg.turn_seconds,'target',cfg.match_target);
    end if;
  end if;
  select mq.profile_id, mq.rating into partner_id, partner_rating from public.matchmaking_queue mq join public.profiles p on p.id=mq.profile_id
    where mq.table_config_id=p_table_config_id and mq.profile_id<>caller_id and mq.matched_match_id is null and abs(p.pvp_rating-caller_pvp_rating)<=p_rating_band order by mq.created_at asc limit 1 for update skip locked;
  if partner_id is null then
    insert into public.matchmaking_queue (profile_id,target,rating,table_config_id,created_at) values (caller_id,cfg.match_target,caller_pvp_rating,p_table_config_id,now())
    on conflict (profile_id) do update set target=excluded.target, rating=excluded.rating, table_config_id=excluded.table_config_id, created_at=case when public.matchmaking_queue.matched_match_id is null then now() else public.matchmaking_queue.created_at end;
    return jsonb_build_object('status','queued');
  end if;
  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  insert into public.user_wallets (profile_id) values (partner_id) on conflict (profile_id) do nothing;
  if cfg.entry_fee_coins > 0 then
    update public.user_wallets set coins = coins - cfg.entry_fee_coins where profile_id = caller_id and coins >= cfg.entry_fee_coins returning * into caller_wallet;
    if caller_wallet.profile_id is null then raise exception 'insufficient_coins'; end if;
    update public.user_wallets set coins = coins - cfg.entry_fee_coins where profile_id = partner_id and coins >= cfg.entry_fee_coins returning * into partner_wallet;
    if partner_wallet.profile_id is null then update public.user_wallets set coins = coins + cfg.entry_fee_coins where profile_id = caller_id; raise exception 'partner_insufficient_coins'; end if;
    insert into public.wallet_transactions (profile_id,currency,amount,balance_after,source,reason,metadata,created_by)
    values (caller_id,'coins',-cfg.entry_fee_coins,caller_wallet.coins,'entry_fee','PvP entry fee: '||cfg.display_name, jsonb_build_object('table_config_id',p_table_config_id,'mode','online'), caller_id),
           (partner_id,'coins',-cfg.entry_fee_coins,partner_wallet.coins,'entry_fee','PvP entry fee: '||cfg.display_name, jsonb_build_object('table_config_id',p_table_config_id,'mode','online'), partner_id);
  end if;
  -- Coin-flip the owner's colour so the opener (white) is random between the two players.
  insert into public.matches (owner_id,opponent_id,mode,target,table_config_id,owner_color,entry_fee_paid_at)
    values (caller_id,partner_id,'online',cfg.match_target,p_table_config_id,(case when random() < 0.5 then 'black' else 'white' end),now()) returning id into new_match_id;
  update public.matchmaking_queue set matched_match_id = new_match_id where profile_id in (caller_id,partner_id);
  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    insert into public.matchmaking_queue (profile_id,target,rating,table_config_id,matched_match_id,created_at) values (caller_id,cfg.match_target,caller_pvp_rating,p_table_config_id,new_match_id,now())
    on conflict (profile_id) do update set matched_match_id=excluded.matched_match_id;
  end if;
  return jsonb_build_object('status','matched','match_id',new_match_id,'turn_seconds',cfg.turn_seconds,'target',cfg.match_target);
end; $function$;

-- ── AI fallback / server bot ──────────────────────────────────────────────
create or replace function public.enter_room_ai_fallback(p_table_config_id text)
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
  implied_ai_level text;
  effective_ai_level text;
  effective_mode text;
  effective_is_bot boolean;
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

  delete from public.matchmaking_queue
  where profile_id = caller_id and matched_match_id is null;

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

  effective_is_bot := coalesce(cfg.server_bot, false);
  effective_mode := case when effective_is_bot then 'online' else 'ai-' || effective_ai_level end;

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
         'is_bot', effective_is_bot,
         'bot_level', effective_ai_level,
         'streak_len', streak_len,
         'implied_ai_level', implied_ai_level,
         'fallback', true
       ),
       caller_id);
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  -- Server-bot (online) matches randomize the opener via owner colour (the
  -- online path is colour-symmetric). Legacy HotSeat (mode='ai-%') keeps the
  -- human as white — HotSeat attributes rewards on that and randomizes its own
  -- opener client-side.
  insert into public.matches
    (owner_id, mode, target, table_config_id, owner_color, is_bot, bot_level, entry_fee_paid_at)
  values
    (caller_id, effective_mode, cfg.match_target, p_table_config_id,
     (case when effective_is_bot and random() < 0.5 then 'black' else 'white' end),
     effective_is_bot,
     case when effective_is_bot then effective_ai_level else null end,
     now())
  returning id into new_match_id;

  return jsonb_build_object(
    'match_id', new_match_id,
    'turn_seconds', cfg.turn_seconds,
    'mode', effective_mode,
    'target', cfg.match_target,
    'ai_level', effective_ai_level,
    'is_bot', effective_is_bot,
    'bot_level', case when effective_is_bot then effective_ai_level else null end,
    'streak_len', streak_len,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
  );
end;
$$;

grant execute on function public.find_match_in_tier(text, integer) to authenticated;
grant execute on function public.enter_room_ai_fallback(text) to authenticated;
