-- Hourly Bonus Wheel — schema + RPCs.
--
-- A second daily-bonus loop running in parallel with the 7-day
-- streak calendar. Players spin a wheel every cooldown_seconds
-- (default 1h, BO-tunable: 5min..7d) and land on one of N slots
-- (up to 32; the BO ships 10). Each slot can deliver up to two
-- rewards (primary + optional secondary) of any registered type
-- (coins, gems, xp, and any future types added in spin_wheel's
-- credit branch).
--
-- Chance is stored as INTEGER BASIS POINTS (1 bp = 0.01%, so a
-- well-configured wheel's slots sum to exactly 10000). Using
-- integers avoids floating-point drift in the weighted RNG and
-- gives the BO 0.01% precision without surprises.
--
-- Server is the sole authority on which slot the player lands on.
-- The client receives back the picked slot_index and animates
-- toward it — no tampered client can claim a different prize.

-- ============================================================
-- wheel_configs — one row per wheel "instance". Ships with one
-- ('main') but the schema supports multiples so a later VIP /
-- event wheel doesn't require a migration.
-- ============================================================
create table public.wheel_configs (
  id text primary key,
  display_name text not null,
  cooldown_seconds int not null default 3600
    check (cooldown_seconds between 300 and 604800),  -- 5min..7d
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger wheel_configs_updated_at
  before update on public.wheel_configs
  for each row execute function public.set_updated_at();

-- ============================================================
-- wheel_slots — per-slot prize + chance. PK is (config_id,
-- slot_index) so a wheel is edited row-by-row in the BO.
--
-- Two reward fields per slot (primary always present, secondary
-- optional). reward_type is a free-form slug — adding "xp_boost"
-- or "board_theme" is a one-line CASE branch in spin_wheel, NOT
-- a migration.
--
-- chance_basis_points: 0..10000, integer. Sum across enabled
-- slots MUST equal 10000; enforced server-side at spin time and
-- visualised live in the BO before save.
-- ============================================================
create table public.wheel_slots (
  config_id text not null references public.wheel_configs(id) on delete cascade,
  slot_index int not null check (slot_index between 0 and 31),

  primary_reward_type text not null check (primary_reward_type <> ''),
  primary_reward_amount int not null check (primary_reward_amount >= 0),
  primary_reward_icon_url text,

  secondary_reward_type text,
  secondary_reward_amount int check (secondary_reward_amount is null or secondary_reward_amount >= 0),
  secondary_reward_icon_url text,

  chance_basis_points int not null check (chance_basis_points between 0 and 10000),
  label text,
  accent_color text not null default 'gold',
  is_enabled boolean not null default true,

  primary key (config_id, slot_index),
  -- Secondary fields must both be set or both null.
  check (
    (secondary_reward_type is null and secondary_reward_amount is null) or
    (secondary_reward_type is not null and secondary_reward_amount is not null)
  )
);
create index wheel_slots_config_idx on public.wheel_slots (config_id, slot_index);

-- ============================================================
-- user_wheel_spins — per-player cooldown anchor + telemetry.
-- ============================================================
create table public.user_wheel_spins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  config_id text not null references public.wheel_configs(id) on delete cascade,
  last_spin_at timestamptz,
  total_spins int not null default 0,
  last_slot_index int,
  last_reward_coins int not null default 0,
  last_reward_gems int not null default 0,
  last_reward_xp int not null default 0
);

-- ============================================================
-- RLS — configs + slots world-readable, writes admin-only;
-- spin rows readable by their owner, writes RPC-only.
-- ============================================================
alter table public.wheel_configs enable row level security;
alter table public.wheel_slots enable row level security;
alter table public.user_wheel_spins enable row level security;

create policy wheel_configs_read on public.wheel_configs for select using (true);
create policy wheel_slots_read on public.wheel_slots for select using (true);
create policy wheel_configs_admin_write on public.wheel_configs
  for all using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy wheel_slots_admin_write on public.wheel_slots
  for all using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy user_wheel_spins_own_read on public.user_wheel_spins
  for select using (profile_id = auth.uid());

-- ============================================================
-- Seed: default 10-slot wheel summing to exactly 10000 bp.
-- Includes two example "combo" slots that demonstrate the
-- secondary-reward shape.
-- ============================================================
insert into public.wheel_configs (id, display_name, cooldown_seconds, is_enabled)
values ('main', 'Hourly Bonus', 3600, true);

insert into public.wheel_slots
  (config_id, slot_index,
   primary_reward_type, primary_reward_amount, primary_reward_icon_url,
   secondary_reward_type, secondary_reward_amount, secondary_reward_icon_url,
   chance_basis_points, label, accent_color, is_enabled)
values
  ('main', 0, 'coins',  100, '/lobby/icons/gold-coin.webp', null, null, null, 2500, '100 COINS',   'gold',   true),
  ('main', 1, 'gems',     5, '/lobby/icons/gem.webp',       null, null, null, 1500, '5 GEMS',      'purple', true),
  ('main', 2, 'coins',  200, '/lobby/icons/gold-coin.webp', 'xp',    5, '/lobby/icons/xp.webp', 1800, '200 COINS + 5 XP', 'red', true),
  ('main', 3, 'xp',     10, '/lobby/icons/xp.webp',         null, null, null, 1200, '10 XP',       'green',  true),
  ('main', 4, 'coins',  500, '/lobby/icons/gold-coin.webp', null, null, null, 1000, '500 COINS',   'blue',   true),
  ('main', 5, 'gems',    10, '/lobby/icons/gem.webp',       'coins', 50, '/lobby/icons/gold-coin.webp', 800, '10 GEMS + 50 COINS', 'orange', true),
  ('main', 6, 'coins', 1000, '/lobby/icons/gold-coin.webp', null, null, null,  500, '1K COINS',    'red',    true),
  ('main', 7, 'xp',     25, '/lobby/icons/xp.webp',         null, null, null,  400, '25 XP',       'green',  true),
  ('main', 8, 'gems',   25, '/lobby/icons/gem.webp',        null, null, null,  250, '25 GEMS',     'purple', true),
  ('main', 9, 'coins', 5000, '/lobby/icons/gold-coin.webp', 'gems', 10, '/lobby/icons/gem.webp', 50, 'JACKPOT', 'gold', true);

-- ============================================================
-- get_wheel_state — single round-trip for the lobby pill + the
-- wheel modal. Each slot is returned with primary_reward and
-- (nullable) secondary_reward sub-objects so the client can
-- render two icons / single icon / future N icons without a
-- shape change.
-- ============================================================
create or replace function public.get_wheel_state(
  p_config_id text default 'main'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  cfg public.wheel_configs;
  spin_row public.user_wheel_spins;
  slots_json jsonb;
  next_spin_at timestamptz;
  can_spin_now boolean;
begin
  select * into cfg from public.wheel_configs where id = p_config_id;
  if not found then raise exception 'wheel_not_found'; end if;
  if caller_id is not null then
    select * into spin_row from public.user_wheel_spins
      where profile_id = caller_id and config_id = p_config_id;
  end if;
  next_spin_at := case
    when spin_row.last_spin_at is null then now()
    else spin_row.last_spin_at + (cfg.cooldown_seconds || ' seconds')::interval
  end;
  can_spin_now := cfg.is_enabled and next_spin_at <= now();
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'slot_index', s.slot_index,
      'chance_basis_points', s.chance_basis_points,
      'label', s.label,
      'accent_color', s.accent_color,
      'is_enabled', s.is_enabled,
      'primary_reward', jsonb_build_object(
        'type', s.primary_reward_type,
        'amount', s.primary_reward_amount,
        'icon_url', s.primary_reward_icon_url
      ),
      'secondary_reward', case
        when s.secondary_reward_type is null then null
        else jsonb_build_object(
          'type', s.secondary_reward_type,
          'amount', s.secondary_reward_amount,
          'icon_url', s.secondary_reward_icon_url
        )
      end
    ) order by s.slot_index
  ), '[]'::jsonb) into slots_json
  from public.wheel_slots s where s.config_id = p_config_id;
  return jsonb_build_object(
    'config_id', cfg.id,
    'display_name', cfg.display_name,
    'cooldown_seconds', cfg.cooldown_seconds,
    'is_enabled', cfg.is_enabled,
    'next_spin_at', next_spin_at,
    'can_spin_now', can_spin_now,
    'last_spin_at', spin_row.last_spin_at,
    'last_slot_index', spin_row.last_slot_index,
    'slots', slots_json
  );
end;
$$;
grant execute on function public.get_wheel_state(text) to authenticated, anon;

-- ============================================================
-- spin_wheel — atomic; cooldown gate, weighted pick, credit each
-- reward via a per-type CASE. Adding a new reward type means
-- adding a CASE branch here (and the BO's type dropdown). The
-- default branch silently skips unknown types so a partly-rolled-
-- out new type doesn't break the spin for existing players.
-- ============================================================
create or replace function public.spin_wheel(
  p_config_id text default 'main'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  case chosen.primary_reward_type
    when 'coins' then credited_coins := credited_coins + chosen.primary_reward_amount;
    when 'gems'  then credited_gems  := credited_gems  + chosen.primary_reward_amount;
    when 'xp'    then credited_xp    := credited_xp    + chosen.primary_reward_amount;
    else null;
  end case;
  if chosen.secondary_reward_type is not null then
    case chosen.secondary_reward_type
      when 'coins' then credited_coins := credited_coins + chosen.secondary_reward_amount;
      when 'gems'  then credited_gems  := credited_gems  + chosen.secondary_reward_amount;
      when 'xp'    then credited_xp    := credited_xp    + chosen.secondary_reward_amount;
      else null;
    end case;
  end if;

  if credited_coins > 0 or credited_gems > 0 then
    update public.user_wallets
      set coins = coins + credited_coins, gems = gems + credited_gems
      where profile_id = caller_id returning * into wallet_row;
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
$$;
grant execute on function public.spin_wheel(text) to authenticated;

comment on function public.spin_wheel(text) is
  'Atomic spin: cooldown gate, weighted random sample over chance_basis_points, credit primary + (optional) secondary rewards via per-type CASE. Adding a new reward type = one CASE branch here. Raises: not_authenticated, wheel_not_found, wheel_disabled, cooldown_not_elapsed, wheel_misconfigured, wheel_no_slot_picked.';
