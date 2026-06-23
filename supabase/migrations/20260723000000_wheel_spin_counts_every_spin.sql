-- Fix: the "Spin the wheel" daily mission (metric wheel_spins_per_day) never
-- progressed for gems-only or xp-only spins.
--
-- Root cause: wheel_spins_per_day was incremented as a SIDE EFFECT of the coins
-- ledger row in spin_wheel, via the wallet_transactions_progress_missions
-- trigger (it fired on currency='coins' AND source='wheel_spin'). But spin_wheel
-- only writes that coins row when `credited_coins > 0`. A spin that lands on a
-- gems-only slot (e.g. "5 GEMS", "25 GEMS") or an xp-only slot writes NO coins
-- ledger row, so the trigger never fired and the mission stayed at 0/N. The
-- metric means "a spin happened", but it was wired to "a coin-paying spin
-- happened".
--
-- Fix: count the spin directly inside spin_wheel (once per spin, regardless of
-- prize currency), and remove the wheel_spin branch from the wallet trigger so
-- coin-paying spins are not counted twice. spin_wheel becomes the single source
-- of truth for the wheel_spins_per_day metric.

-- ── 1. spin_wheel: count every spin toward wheel_spins_per_day ──────────────
-- Reproduces the live function verbatim with ONE addition: a progress_mission
-- call after the spin is durably recorded in user_wheel_spins.
create or replace function public.spin_wheel(p_config_id text default 'main'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  caller_id uuid := auth.uid();
  cfg public.wheel_configs;
  spin_row public.user_wheel_spins;
  total_weight int;
  random_pick int;
  chosen public.wheel_slots;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  next_spin_at timestamptz;
  credited_coins int := 0;
  credited_gems int := 0;
  credited_xp int := 0;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.wheel_configs where id = p_config_id for update;
  if not found then raise exception 'wheel_not_found'; end if;
  if not cfg.is_enabled then raise exception 'wheel_disabled'; end if;
  select * into spin_row from public.user_wheel_spins
    where profile_id = caller_id and config_id = p_config_id for update;
  if found and spin_row.last_spin_at is not null
     and spin_row.last_spin_at + (cfg.cooldown_seconds || ' seconds')::interval > now() then
    raise exception 'cooldown_not_elapsed';
  end if;
  select coalesce(sum(chance_basis_points), 0) into total_weight
    from public.wheel_slots where config_id = p_config_id and is_enabled;
  if total_weight <> 10000 then raise exception 'wheel_misconfigured'; end if;
  random_pick := floor(random() * total_weight)::int;
  if random_pick = total_weight then random_pick := total_weight - 1; end if;
  with cumulative as (
    select slot_index, chance_basis_points,
      sum(chance_basis_points) over (
        order by slot_index rows between unbounded preceding and current row
      ) as cum_sum
    from public.wheel_slots where config_id = p_config_id and is_enabled
  )
  select s.* into chosen
    from public.wheel_slots s
    join cumulative c on c.slot_index = s.slot_index
    where s.config_id = p_config_id and c.cum_sum > random_pick
    order by s.slot_index asc limit 1;
  if chosen.config_id is null then raise exception 'wheel_no_slot_picked'; end if;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;

  -- Credit primary reward.
  case chosen.primary_reward_type
    when 'coins' then credited_coins := credited_coins + chosen.primary_reward_amount;
    when 'gems'  then credited_gems  := credited_gems  + chosen.primary_reward_amount;
    when 'xp'    then credited_xp    := credited_xp    + chosen.primary_reward_amount;
    else null; -- unknown type: don't fail the spin
  end case;

  -- Credit secondary reward when present.
  if chosen.secondary_reward_type is not null then
    case chosen.secondary_reward_type
      when 'coins' then credited_coins := credited_coins + chosen.secondary_reward_amount;
      when 'gems'  then credited_gems  := credited_gems  + chosen.secondary_reward_amount;
      when 'xp'    then credited_xp    := credited_xp    + chosen.secondary_reward_amount;
      else null;
    end case;
  end if;

  -- Apply aggregated deltas in one wallet UPDATE.
  if credited_coins > 0 or credited_gems > 0 then
    update public.user_wallets
      set coins = coins + credited_coins,
          gems  = gems  + credited_gems
      where profile_id = caller_id
      returning * into wallet_row;
    if credited_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'coins', credited_coins, wallet_row.coins, 'wheel_spin',
         'Hourly wheel: ' || coalesce(chosen.label, 'slot ' || chosen.slot_index),
         jsonb_build_object('config_id', p_config_id, 'slot_index', chosen.slot_index,
           'credited_gems', credited_gems, 'credited_xp', credited_xp),
         caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  if credited_xp > 0 then
    update public.profiles set xp = xp + credited_xp
      where id = caller_id returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  next_spin_at := now() + (cfg.cooldown_seconds || ' seconds')::interval;
  insert into public.user_wheel_spins
    (profile_id, config_id, last_spin_at, total_spins,
     last_slot_index, last_reward_coins, last_reward_gems, last_reward_xp)
  values
    (caller_id, p_config_id, now(), 1,
     chosen.slot_index, credited_coins, credited_gems, credited_xp)
  on conflict (profile_id) do update
    set last_spin_at = excluded.last_spin_at,
        total_spins = public.user_wheel_spins.total_spins + 1,
        last_slot_index = excluded.last_slot_index,
        last_reward_coins = excluded.last_reward_coins,
        last_reward_gems = excluded.last_reward_gems,
        last_reward_xp = excluded.last_reward_xp,
        config_id = excluded.config_id;

  -- Count the spin toward the wheel_spins_per_day daily mission. Done HERE (not
  -- via the wallet_transactions trigger) so EVERY spin counts -- including
  -- gems-only / xp-only prizes that write no coins ledger row. clock_timestamp()
  -- gives a unique idempotency key per spin (advances within the txn).
  perform public.progress_mission(
    caller_id, 'wheel_spins_per_day', 1,
    'spin:' || caller_id::text || ':' || clock_timestamp()::text);

  return jsonb_build_object(
    'slot_index', chosen.slot_index,
    'label', chosen.label,
    'accent_color', chosen.accent_color,
    'primary_reward', jsonb_build_object(
      'type', chosen.primary_reward_type,
      'amount', chosen.primary_reward_amount,
      'icon_url', chosen.primary_reward_icon_url
    ),
    'secondary_reward', case
      when chosen.secondary_reward_type is null then null
      else jsonb_build_object(
        'type', chosen.secondary_reward_type,
        'amount', chosen.secondary_reward_amount,
        'icon_url', chosen.secondary_reward_icon_url
      )
    end,
    'credited_coins', credited_coins,
    'credited_gems', credited_gems,
    'credited_xp', credited_xp,
    'next_spin_at', next_spin_at,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
  );
end;
$function$;

-- ── 2. wallet trigger: drop the wheel_spin branch (now owned by spin_wheel) ──
-- Otherwise a coin-paying spin would count twice (once here, once in spin_wheel).
create or replace function public.wallet_transactions_progress_missions()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if NEW.currency = 'coins' then
    -- NOTE: wheel_spins_per_day is intentionally NOT handled here. spin_wheel
    -- counts every spin directly so gems-only / xp-only spins also count.
    if NEW.source = 'entry_fee' then
      perform public.progress_mission(NEW.profile_id, 'coins_wagered_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
    elsif NEW.source = 'match_reward' and NEW.amount > 0 then
      perform public.progress_mission(NEW.profile_id, 'coins_won_net_per_day', NEW.amount, 'wt:' || NEW.id::text);
    end if;
  end if;
  if NEW.currency = 'gems' and NEW.amount < 0 and NEW.source in ('purchase', 'mission_reroll_fee') then
    perform public.progress_mission(NEW.profile_id, 'gems_spent_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
  end if;
  return NEW;
end;
$function$;
