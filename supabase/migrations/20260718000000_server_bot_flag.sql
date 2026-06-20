-- Phase 2b layer 2 slice 2b — per-tier dark-launch flag + AI match reroute.
--
-- `table_configs.server_bot` (default FALSE) controls, per difficulty tier,
-- whether that tier's vs-AI matches run as a SERVER BOT on the online path
-- (mode='online' + is_bot, played through roll_dice/finish_turn/ai_move —
-- fully server-authoritative) vs the legacy client-side HotSeat (mode='ai-%').
--
-- Default false everywhere = the live economy is UNTOUCHED until a tier is
-- explicitly flipped on (per-tier staged rollout). This closes the live AI
-- coin-mint for whichever tiers are switched over.

alter table public.table_configs
  add column if not exists server_bot boolean not null default false;

comment on column public.table_configs.server_bot is
  'Phase 2b layer 2: when true, this tier''s vs-AI matches run as a server bot on the online path (mode=online + is_bot, server-authoritative) instead of client-side HotSeat (mode=ai-%). Default false = legacy HotSeat. Flip per-tier to roll out.';

-- enter_room_ai_fallback: when the tier has server_bot, create the match as an
-- ONLINE BOT match (mode='online', is_bot=true, bot_level=<level>, owner=white
-- so the human rolls first) instead of mode='ai-<level>'. Everything else
-- (rating-implied level, tier floor, streak escalator, entry fee) is unchanged.
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

  -- Server-bot tiers create an ONLINE match (the bot plays via ai_move);
  -- legacy tiers keep mode='ai-<level>' (client-side HotSeat).
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

  insert into public.matches
    (owner_id, mode, target, table_config_id, owner_color, is_bot, bot_level)
  values
    (caller_id, effective_mode, cfg.match_target, p_table_config_id,
     'white', effective_is_bot,
     case when effective_is_bot then effective_ai_level else null end)
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

comment on function public.enter_room_ai_fallback(text) is
  'AI fallback path for the PvP-first flow. Picks AI level from caller pvp_rating with cfg.ai_level as floor + win-streak escalator, debits entry fee, creates the AI match. When cfg.server_bot: creates an ONLINE bot match (mode=online, is_bot, bot_level, owner=white) played server-authoritatively via ai_move; else legacy mode=ai-<level> (HotSeat). Raises: not_authenticated, room_not_found, room_disabled, ai_not_allowed, insufficient_coins.';
