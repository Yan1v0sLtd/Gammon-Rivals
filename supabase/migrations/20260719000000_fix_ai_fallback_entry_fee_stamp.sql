-- Regression fix — restore entry_fee_paid_at stamping in enter_room_ai_fallback.
--
-- Migration 20260718 (server_bot flag) recreated enter_room_ai_fallback from an
-- older (pre-20260710) copy of the function, which silently dropped the
-- `entry_fee_paid_at = now()` stamp that 20260710 added. grant_match_reward
-- gates the ENTIRE payout on `entry_fee_paid_at is not null`, so without the
-- stamp NO ai-fallback match (server-bot OR legacy HotSeat) pays its winner.
-- Caught by the first live Beginner playthrough: a natural win credited 0.
--
-- This recreates the function identically to 20260718 but adds the stamp back
-- to the INSERT (now stamping the new owner_color/is_bot/bot_level columns too).

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

  -- entry_fee_paid_at = now() is REQUIRED: grant_match_reward gates the whole
  -- payout on it (server-charged-entry proof). Dropping it = winners get 0.
  insert into public.matches
    (owner_id, mode, target, table_config_id, owner_color, is_bot, bot_level, entry_fee_paid_at)
  values
    (caller_id, effective_mode, cfg.match_target, p_table_config_id,
     'white', effective_is_bot,
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

grant execute on function public.enter_room_ai_fallback(text) to authenticated;
