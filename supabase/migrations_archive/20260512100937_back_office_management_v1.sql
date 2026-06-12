-- Back Office V1 management model.
-- Adds user progression, wallets, ownership, purchases, shop config, and
-- guarded admin RPCs for safe currency changes.

create schema if not exists private;

-- Profiles become operable from the Back Office.
alter table public.profiles
  add column if not exists level int not null default 1 check (level > 0),
  add column if not exists xp int not null default 0 check (xp >= 0),
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists admin_note text,
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_level_idx on public.profiles (level);
create index if not exists profiles_suspended_idx on public.profiles (is_suspended);

create or replace function private.is_admin(check_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_roles
    where profile_id = check_profile_id
      and role in ('owner', 'admin', 'support', 'viewer')
  );
$$;

create or replace function private.can_manage_config(check_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_roles
    where profile_id = check_profile_id
      and role in ('owner', 'admin')
  );
$$;

grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin(uuid) to anon, authenticated;
grant execute on function private.can_manage_config(uuid) to anon, authenticated;

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- Board themes need asset fields that can grow beyond the current board image.
alter table public.board_theme_configs
  add column if not exists white_checker_image text,
  add column if not exists black_checker_image text,
  add column if not exists dice_image text,
  add column if not exists tray_image text,
  add column if not exists holder_image text;

-- ---------------------------------------------------------------------------
-- Wallets and economy ledger
-- ---------------------------------------------------------------------------
create table if not exists public.user_wallets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  gems int not null default 0 check (gems >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_wallets_updated_at on public.user_wallets;
create trigger user_wallets_updated_at
  before update on public.user_wallets
  for each row execute function public.set_updated_at();

alter table public.user_wallets enable row level security;

drop policy if exists "user_wallets_select_own_or_admin" on public.user_wallets;
create policy "user_wallets_select_own_or_admin"
  on public.user_wallets for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "user_wallets_insert_admin" on public.user_wallets;
create policy "user_wallets_insert_admin"
  on public.user_wallets for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "user_wallets_update_admin" on public.user_wallets;
create policy "user_wallets_update_admin"
  on public.user_wallets for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  currency text not null check (currency in ('coins', 'gems')),
  amount int not null check (amount <> 0),
  balance_after int not null check (balance_after >= 0),
  source text not null default 'admin_adjustment'
    check (source in ('admin_adjustment', 'match_reward', 'purchase', 'daily_bonus', 'level_reward', 'refund', 'system')),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_profile_recent_idx
  on public.wallet_transactions (profile_id, created_at desc);

alter table public.wallet_transactions enable row level security;

drop policy if exists "wallet_transactions_select_own_or_admin" on public.wallet_transactions;
create policy "wallet_transactions_select_own_or_admin"
  on public.wallet_transactions for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "wallet_transactions_insert_admin" on public.wallet_transactions;
create policy "wallet_transactions_insert_admin"
  on public.wallet_transactions for insert
  with check (private.can_manage_config(auth.uid()));

-- Keep a wallet row available for every profile.
create or replace function private.ensure_user_wallet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_wallets (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_create_wallet on public.profiles;
create trigger profiles_create_wallet
  after insert on public.profiles
  for each row execute function private.ensure_user_wallet();

insert into public.user_wallets (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

create or replace function public.admin_adjust_wallet(
  target_profile_id uuid,
  currency_code text,
  delta_amount int,
  adjustment_reason text
)
returns public.user_wallets
language plpgsql
set search_path = public, pg_temp
as $$
declare
  wallet_row public.user_wallets;
  new_balance int;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'admin_required';
  end if;

  if currency_code not in ('coins', 'gems') then
    raise exception 'invalid_currency';
  end if;

  if delta_amount = 0 then
    raise exception 'amount_must_not_be_zero';
  end if;

  if trim(coalesce(adjustment_reason, '')) = '' then
    raise exception 'reason_required';
  end if;

  insert into public.user_wallets (profile_id)
  values (target_profile_id)
  on conflict (profile_id) do nothing;

  if currency_code = 'coins' then
    update public.user_wallets
    set coins = coins + delta_amount
    where profile_id = target_profile_id
      and coins + delta_amount >= 0
    returning * into wallet_row;
    new_balance := wallet_row.coins;
  else
    update public.user_wallets
    set gems = gems + delta_amount
    where profile_id = target_profile_id
      and gems + delta_amount >= 0
    returning * into wallet_row;
    new_balance := wallet_row.gems;
  end if;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_balance';
  end if;

  insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
  values
    (target_profile_id, currency_code, delta_amount, new_balance, 'admin_adjustment', adjustment_reason, '{}'::jsonb, auth.uid());

  return wallet_row;
end;
$$;

grant execute on function public.admin_adjust_wallet(uuid, text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Inventory, purchases, and shop config
-- ---------------------------------------------------------------------------
create table if not exists public.user_board_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  board_theme_id text not null references public.board_theme_configs(id) on delete cascade,
  source text not null default 'admin_grant'
    check (source in ('default', 'purchase', 'level_reward', 'admin_grant', 'bundle')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, board_theme_id)
);

create index if not exists user_board_inventory_board_idx
  on public.user_board_inventory (board_theme_id);

alter table public.user_board_inventory enable row level security;

drop policy if exists "user_board_inventory_select_own_or_admin" on public.user_board_inventory;
create policy "user_board_inventory_select_own_or_admin"
  on public.user_board_inventory for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "user_board_inventory_write_admin" on public.user_board_inventory;
create policy "user_board_inventory_write_admin"
  on public.user_board_inventory for all
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

insert into public.user_board_inventory (profile_id, board_theme_id, source)
select p.id, 'classic-green', 'default'
from public.profiles p
where exists (select 1 from public.board_theme_configs b where b.id = 'classic-green')
on conflict (profile_id, board_theme_id) do nothing;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  product_id text not null,
  product_type text not null
    check (product_type in ('coin_pack', 'gem_pack', 'board_theme', 'cosmetic', 'bundle', 'special_offer')),
  provider text not null default 'admin'
    check (provider in ('apple', 'google', 'stripe', 'admin', 'test')),
  provider_transaction_id text,
  price_cents int check (price_cents is null or price_cents >= 0),
  currency_code text not null default 'USD',
  contents jsonb not null default '{}'::jsonb check (jsonb_typeof(contents) = 'object'),
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed', 'refunded', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists purchases_profile_recent_idx
  on public.purchases (profile_id, created_at desc);

alter table public.purchases enable row level security;

drop policy if exists "purchases_select_own_or_admin" on public.purchases;
create policy "purchases_select_own_or_admin"
  on public.purchases for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "purchases_insert_admin" on public.purchases;
create policy "purchases_insert_admin"
  on public.purchases for insert
  with check (private.can_manage_config(auth.uid()));

create table if not exists public.shop_items (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]*$'),
  kind text not null
    check (kind in ('coin_pack', 'gem_pack', 'board_theme', 'cosmetic', 'bundle', 'special_offer')),
  display_name text not null,
  description text not null default '',
  image_url text,
  price_cents int check (price_cents is null or price_cents >= 0),
  price_coins int check (price_coins is null or price_coins >= 0),
  price_gems int check (price_gems is null or price_gems >= 0),
  apple_product_id text,
  google_product_id text,
  contents jsonb not null default '{}'::jsonb check (jsonb_typeof(contents) = 'object'),
  visibility_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(visibility_rules) = 'object'),
  starts_at timestamptz,
  ends_at timestamptz,
  max_purchases_per_user int check (max_purchases_per_user is null or max_purchases_per_user > 0),
  is_enabled boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_items_enabled_sort_idx
  on public.shop_items (is_enabled, sort_order, kind);

drop trigger if exists shop_items_updated_at on public.shop_items;
create trigger shop_items_updated_at
  before update on public.shop_items
  for each row execute function public.set_updated_at();

alter table public.shop_items enable row level security;

drop policy if exists "shop_items_read_all" on public.shop_items;
create policy "shop_items_read_all"
  on public.shop_items for select
  using (true);

drop policy if exists "shop_items_insert_admin" on public.shop_items;
create policy "shop_items_insert_admin"
  on public.shop_items for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "shop_items_update_admin" on public.shop_items;
create policy "shop_items_update_admin"
  on public.shop_items for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "shop_items_delete_admin" on public.shop_items;
create policy "shop_items_delete_admin"
  on public.shop_items for delete
  using (private.can_manage_config(auth.uid()));

insert into public.shop_items
  (id, kind, display_name, description, image_url, price_cents, contents, is_enabled, sort_order)
values
  ('small-coins', 'coin_pack', 'Small Coins Pack', 'Starter coin refill.', '/lobby/currency/gold-coin.webp', 199, '{"coins":1000}', false, 10),
  ('classic-green-board', 'board_theme', 'Classic Green Board', 'Default classic board theme.', '/lobby/board-previews/classic-green.webp', null, '{"boardThemeId":"classic-green"}', true, 20)
on conflict (id) do nothing;

-- Ensure admin audit catches new shop changes where the earlier trigger exists.
create or replace function private.log_admin_config_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  target_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    before_row := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    after_row := to_jsonb(new);
  end if;

  target_id := coalesce(
    after_row ->> 'id',
    after_row ->> 'profile_id',
    after_row ->> 'level',
    before_row ->> 'id',
    before_row ->> 'profile_id',
    before_row ->> 'level',
    ''
  );

  insert into public.admin_audit_log
    (actor_profile_id, action, entity_table, entity_id, before_value, after_value)
  values
    (auth.uid(), lower(tg_op), tg_table_name, target_id, before_row, after_row);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_items_audit_log on public.shop_items;
create trigger shop_items_audit_log
  after insert or update or delete on public.shop_items
  for each row execute function private.log_admin_config_change();
