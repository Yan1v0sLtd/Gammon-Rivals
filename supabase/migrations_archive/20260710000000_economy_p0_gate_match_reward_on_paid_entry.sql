-- ============================================================================
-- Economy hardening: pay match rewards only for matches with a real paid entry.
--
-- Adds matches.entry_fee_paid_at, stamped ONLY by the entry RPCs (enter_room,
-- enter_room_ai_fallback, find_match_in_tier) when a tiered match is created.
-- finish_match now grants coins / XP / rating ONLY when that stamp is present,
-- so a directly-inserted match (which can carry a table_config_id but was never
-- charged a fee) yields no reward. The rating/ELO update is likewise gated so
-- only ranked paid matches move pvp_rating.
--
-- No RLS or client change; legitimate paid matches (and the 2 in-flight ones,
-- backfilled below) are unaffected. Rationale + threat model: private security
-- audit report (kept outside this public repo).
-- ============================================================================

alter table public.matches
  add column if not exists entry_fee_paid_at timestamptz;

comment on column public.matches.entry_fee_paid_at is
  'Set by the entry RPCs (enter_room / enter_room_ai_fallback / find_match_in_tier) '
  'when a tiered match is created and its fee charged. finish_match pays coins/XP/'
  'rating ONLY when this is non-null — proof the match is economy-bearing. A client '
  'cannot set it (direct INSERT cannot reach these SECURITY DEFINER functions).';

-- Protect the 2 currently in-flight paid matches (created pre-fix via the
-- legit RPCs): stamp them so their payout still works when they finish.
-- Finished matches are irrelevant (finish_match rejects re-finish).
update public.matches
set entry_fee_paid_at = started_at
where table_config_id is not null
  and finished_at is null
  and entry_fee_paid_at is null;

-- ---------------------------------------------------------------------------
-- enter_room (2-arg) — stamp entry_fee_paid_at on the created match.
-- ---------------------------------------------------------------------------
create or replace function public.enter_room(p_table_config_id text, p_match_mode text default 'ai-medium'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  caller_id uuid := auth.uid();
  caller_level int;
  cfg public.table_configs;
  wallet_row public.user_wallets;
  new_match_id uuid;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  if p_match_mode not in ('hotseat', 'ai-easy', 'ai-medium', 'ai-hard') then
    raise exception 'unsupported_match_mode';
  end if;
  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then raise exception 'room_not_found'; end if;
  if not cfg.is_enabled then raise exception 'room_disabled'; end if;
  if p_match_mode like 'ai-%' and not cfg.allow_ai then raise exception 'ai_not_allowed'; end if;
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level, 1) < cfg.required_level then
      raise exception 'level_too_low';
    end if;
  end if;
  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  if cfg.entry_fee_coins > 0 then
    update public.user_wallets set coins = coins - cfg.entry_fee_coins
      where profile_id = caller_id and coins >= cfg.entry_fee_coins
      returning * into wallet_row;
    if wallet_row.profile_id is null then raise exception 'insufficient_coins'; end if;
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
  insert into public.matches (owner_id, mode, target, table_config_id, entry_fee_paid_at)
    values (caller_id, p_match_mode, cfg.match_target, p_table_config_id, now())
    returning id into new_match_id;
  return jsonb_build_object(
    'match_id', new_match_id,
    'turn_seconds', cfg.turn_seconds,
    'mode', p_match_mode,
    'target', cfg.match_target,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- enter_room_ai_fallback — stamp entry_fee_paid_at on the created match.
-- ---------------------------------------------------------------------------
create or replace function public.enter_room_ai_fallback(p_table_config_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    (owner_id, mode, target, table_config_id, entry_fee_paid_at)
  values
    (caller_id, effective_mode, cfg.match_target, p_table_config_id, now())
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
$function$;

-- ---------------------------------------------------------------------------
-- find_match_in_tier — stamp entry_fee_paid_at on the created PvP match.
-- ---------------------------------------------------------------------------
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
    (owner_id, opponent_id, mode, target, table_config_id, owner_color, entry_fee_paid_at)
  values
    (caller_id, partner_id, 'online', cfg.match_target, p_table_config_id, 'white', now())
  returning id into new_match_id;

  update public.matchmaking_queue
    set matched_match_id = new_match_id
    where profile_id in (caller_id, partner_id);
  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
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
$function$;

-- ---------------------------------------------------------------------------
-- finish_match — pay coins/XP/rating ONLY for a match with a real paid entry
-- (entry_fee_paid_at set by an entry RPC). Two added guards, marked [P0 FIX].
-- Body otherwise identical to the pre-fix version.
-- ---------------------------------------------------------------------------
create or replace function public.finish_match(p_match_id uuid, p_white_score integer, p_black_score integer, p_winner text, p_crawford_game_number integer default null::integer, p_owner_abandoned boolean default false, p_opponent_abandoned boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
  cfg public.table_configs;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  is_pvp boolean;
  xp_mult int;
  xp_awarded int;
  coins_awarded int;
  owner_won boolean;
  prior_difficulty_matches int := 0;
  risk_free_applied boolean := false;
  pvp_pot int := 0;
  pvp_rake int := 0;
  pvp_winner_coins int := 0;
  pvp_loser_coins int := 0;
  owner_rating int;
  opponent_rating int;
  owner_expected float;
  owner_score float;
  owner_new_rating int;
  opponent_new_rating int;
  k_factor constant int := 32;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_winner is not null and p_winner not in ('white', 'black') then
    raise exception 'invalid_winner';
  end if;

  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if caller_id <> match_row.owner_id and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  update public.matches
  set white_score = p_white_score,
      black_score = p_black_score,
      winner = p_winner,
      crawford_game_number = p_crawford_game_number,
      finished_at = now()
  where id = p_match_id
  returning * into match_row;

  xp_awarded := 0;
  coins_awarded := 0;
  xp_mult := 1;
  owner_won := (p_winner is not null and p_winner = match_row.owner_color);
  is_pvp := match_row.opponent_id is not null;

  if match_row.table_config_id is not null then
    select * into cfg from public.table_configs where id = match_row.table_config_id;
  end if;

  if cfg.id is not null and is_pvp then
    pvp_pot          := 2 * cfg.entry_fee_coins;
    pvp_rake         := pvp_pot * cfg.pvp_rake_pct / 100;
    pvp_loser_coins  := cfg.prize_coins_loss;
    pvp_winner_coins := pvp_pot - pvp_rake - pvp_loser_coins;
    if pvp_winner_coins < 0 then
      pvp_winner_coins := 0;
    end if;
  end if;

  -- [P0 FIX B-ECON-1/B-ECON-4] Pay coins/XP ONLY when the match carries a real
  -- server-charged entry (entry_fee_paid_at). A client-forged match row has
  -- table_config_id set but no stamp → this whole block is skipped → 0 reward.
  if cfg.id is not null and match_row.entry_fee_paid_at is not null then
    -- XP is earned for any paid (tiered) match — win, loss, OR abandon.
    xp_mult := public.current_xp_multiplier(match_row.owner_id);
    xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * xp_mult;

    if owner_won then
      if is_pvp then
        coins_awarded := pvp_winner_coins;
      else
        coins_awarded := cfg.prize_coins;
      end if;
    elsif p_owner_abandoned then
      coins_awarded := 0;
    else
      if is_pvp then
        coins_awarded := pvp_loser_coins;
      else
        coins_awarded := cfg.prize_coins_loss;
        select count(*) into prior_difficulty_matches
        from public.matches
        where owner_id = match_row.owner_id
          and table_config_id is not null
          and finished_at is not null
          and id <> p_match_id;
        if prior_difficulty_matches < 10 then
          if cfg.entry_fee_coins > coins_awarded then
            coins_awarded := cfg.entry_fee_coins;
            risk_free_applied := true;
          end if;
        end if;
      end if;
    end if;

    if xp_awarded > 0 then
      update public.profiles
      set xp = xp + xp_awarded
      where id = match_row.owner_id
      returning * into profile_row;
    else
      select * into profile_row from public.profiles where id = match_row.owner_id;
    end if;

    insert into public.user_wallets (profile_id)
    values (match_row.owner_id)
    on conflict (profile_id) do nothing;

    if coins_awarded > 0 then
      update public.user_wallets
      set coins = coins + coins_awarded
      where profile_id = match_row.owner_id
      returning * into wallet_row;
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (match_row.owner_id, 'coins', coins_awarded, wallet_row.coins, 'match_reward',
         case
           when owner_won then 'Match win: '
           when risk_free_applied then 'Risk-free refund: '
           else 'Match consolation: '
         end || cfg.display_name,
         jsonb_build_object(
           'match_id', p_match_id,
           'table_config_id', cfg.id,
           'owner_won', owner_won,
           'risk_free', risk_free_applied,
           'is_pvp', is_pvp,
           'pvp_pot', case when is_pvp then pvp_pot else null end,
           'pvp_rake', case when is_pvp then pvp_rake else null end,
           'pvp_rake_pct', case when is_pvp then cfg.pvp_rake_pct else null end
         ),
         match_row.owner_id);
    else
      select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    end if;

    if is_pvp then
      declare
        opponent_won boolean := not owner_won;
        opp_xp_mult int := 1;
        opp_xp_awarded int := 0;
        opp_coins_awarded int := 0;
        opp_wallet public.user_wallets;
      begin
        opp_xp_mult := public.current_xp_multiplier(match_row.opponent_id);
        opp_xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * opp_xp_mult;

        if opponent_won then
          opp_coins_awarded := pvp_winner_coins;
        elsif p_opponent_abandoned then
          opp_coins_awarded := 0;
        else
          opp_coins_awarded := pvp_loser_coins;
        end if;

        if opp_xp_awarded > 0 then
          update public.profiles
          set xp = xp + opp_xp_awarded
          where id = match_row.opponent_id;
        end if;

        insert into public.user_wallets (profile_id)
        values (match_row.opponent_id)
        on conflict (profile_id) do nothing;

        if opp_coins_awarded > 0 then
          update public.user_wallets
          set coins = coins + opp_coins_awarded
          where profile_id = match_row.opponent_id
          returning * into opp_wallet;
          insert into public.wallet_transactions
            (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
          values
            (match_row.opponent_id, 'coins', opp_coins_awarded, opp_wallet.coins, 'match_reward',
             case when opponent_won then 'Match win: ' else 'Match consolation: ' end || cfg.display_name,
             jsonb_build_object(
               'match_id', p_match_id,
               'table_config_id', cfg.id,
               'owner_won', owner_won,
               'is_pvp', true,
               'role', 'opponent',
               'pvp_pot', pvp_pot,
               'pvp_rake', pvp_rake,
               'pvp_rake_pct', cfg.pvp_rake_pct
             ),
             match_row.opponent_id);
        end if;
      end;
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    select * into profile_row from public.profiles where id = match_row.owner_id;
  end if;

  -- [P0 FIX] Rating only moves for a real paid (ranked) match. Blocks
  -- forged-opponent rating griefing; no live impact (0 real-opponent matches).
  if is_pvp and p_winner is not null and match_row.entry_fee_paid_at is not null then
    select pvp_rating into owner_rating from public.profiles where id = match_row.owner_id;
    select pvp_rating into opponent_rating from public.profiles where id = match_row.opponent_id;
    owner_rating := coalesce(owner_rating, 1500);
    opponent_rating := coalesce(opponent_rating, 1500);

    owner_expected := 1.0 / (1.0 + power(10.0, (opponent_rating - owner_rating)::float / 400.0));
    owner_score := case when owner_won then 1.0 else 0.0 end;

    owner_new_rating := greatest(0, least(4000,
      owner_rating + round(k_factor * (owner_score - owner_expected))::int));
    opponent_new_rating := greatest(0, least(4000,
      opponent_rating + round(k_factor * ((1.0 - owner_score) - (1.0 - owner_expected)))::int));

    update public.profiles set pvp_rating = owner_new_rating where id = match_row.owner_id;
    update public.profiles set pvp_rating = opponent_new_rating where id = match_row.opponent_id;
  end if;

  return jsonb_build_object(
    'match_id', match_row.id,
    'owner_won', owner_won,
    'is_pvp', is_pvp,
    'xp_awarded', xp_awarded,
    'xp_multiplier', xp_mult,
    'coins_awarded', coins_awarded,
    'risk_free_applied', risk_free_applied,
    'pvp_pot', case when is_pvp then pvp_pot else null end,
    'pvp_rake', case when is_pvp then pvp_rake else null end,
    'owner_rating', owner_new_rating,
    'opponent_rating', opponent_new_rating,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$function$;
