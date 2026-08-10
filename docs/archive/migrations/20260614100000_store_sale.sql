-- Store Sale — a single global, schedulable promo that grants EXTRA currency.
--
-- "Real extra": while a sale is effective, the purchase grant core multiplies a
-- pack's coin + gem grants by (1 + bonus/100). This is enforced server-side in
-- private.apply_shop_grants_and_record so no client can fake the boost — the
-- storefront only *displays* the badge + struck/boosted amounts.
--
-- Scope: one global sale (the BO edits a single row). The table allows an
-- optional schedule window and keeps history; the EFFECTIVE sale is the active,
-- in-window row (latest wins). Seeded OFF so prod economy is unchanged until an
-- operator turns it on.

-- 1. Config table -------------------------------------------------------------
create table if not exists public.store_sales (
  id            uuid primary key default gen_random_uuid(),
  label         text not null default 'Store Sale',
  bonus_percent integer not null default 0 check (bonus_percent >= 0 and bonus_percent <= 1000),
  is_active     boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_store_sales_set_updated_at
  before update on public.store_sales
  for each row execute function public.set_updated_at();

alter table public.store_sales enable row level security;

-- Everyone (guests included) can read the running sale — the storefront shows it.
create policy store_sales_select_all on public.store_sales
  for select using (true);

-- Only config managers (the back-office) can write.
create policy store_sales_write_config on public.store_sales
  for all using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- 2. Effective bonus for the grant core (0 when no sale is running) -----------
create or replace function private.effective_store_sale_bonus()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select bonus_percent
    from public.store_sales
    where is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at   is null or ends_at   >= now())
    order by updated_at desc
    limit 1
  ), 0);
$$;
revoke execute on function private.effective_store_sale_bonus() from public;

-- 3. The effective sale for the storefront (label + bonus + ends_at; 0/1 row) -
create or replace function public.current_store_sale()
returns table (label text, bonus_percent integer, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select label, bonus_percent, ends_at
  from public.store_sales
  where is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  order by updated_at desc
  limit 1;
$$;
grant execute on function public.current_store_sale() to anon, authenticated;

comment on function public.current_store_sale() is
  'Returns the currently-effective store sale (active + within its optional schedule window), or no rows when none is running. Used by the storefront to show the +X% EXTRA badge and boosted amounts. The actual grant boost is applied server-side in private.apply_shop_grants_and_record.';

-- 4. Grant core — apply the sale boost to currency grants ---------------------
-- Unchanged from 20260613000000 except the sale-boost block + sale_bonus_percent
-- recorded on the wallet transactions and the purchases row.
create or replace function private.apply_shop_grants_and_record(
  p_profile_id uuid,
  p_item public.shop_items,
  p_provider text,
  p_txn text
)
returns public.user_wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  grants_obj jsonb;
  grant_key text;
  allowed_grants text[] := array['coins', 'gems', 'boardThemeId', 'xpBoost'];
  wallet_row public.user_wallets;
  grant_coins int;
  grant_gems int;
  grant_board_id text;
  xp_boost_obj jsonb;
  xp_boost_days int;
  xp_boost_mult int;
  sale_bonus int := 0;
  reason_label text := coalesce(p_item.display_name, p_item.id);
begin
  grants_obj := coalesce(p_item.contents -> 'grants', '{}'::jsonb);

  for grant_key in select jsonb_object_keys(grants_obj) loop
    if not (grant_key = any(allowed_grants)) then
      raise exception 'unsupported_grant: %', grant_key;
    end if;
  end loop;

  if grants_obj ? 'xpBoost' then
    xp_boost_obj := grants_obj -> 'xpBoost';
    if jsonb_typeof(xp_boost_obj) <> 'object' then
      raise exception 'invalid_xp_boost_grant';
    end if;
    xp_boost_days := coalesce((xp_boost_obj ->> 'days')::int, 0);
    xp_boost_mult := coalesce((xp_boost_obj ->> 'multiplier')::int, 0);
    if xp_boost_days <= 0 or xp_boost_mult < 2 or xp_boost_mult > 10 then
      raise exception 'invalid_xp_boost_grant';
    end if;
  end if;

  if grants_obj ? 'boardThemeId' then
    if exists (
      select 1 from public.user_board_inventory
      where profile_id = p_profile_id
        and board_theme_id = grants_obj ->> 'boardThemeId'
    ) then
      raise exception 'already_owned_board';
    end if;
  end if;

  insert into public.user_wallets (profile_id) values (p_profile_id)
  on conflict (profile_id) do nothing;
  select * into wallet_row from public.user_wallets where profile_id = p_profile_id;

  grant_coins    := coalesce((grants_obj ->> 'coins')::int, 0);
  grant_gems     := coalesce((grants_obj ->> 'gems')::int, 0);
  grant_board_id := grants_obj ->> 'boardThemeId';

  -- Store Sale: a running sale multiplies the *currency* grants (coins + gems)
  -- by (1 + bonus/100). Authoritative here so no client can fake the boost; the
  -- board / xpBoost grants are intentionally left unscaled (a % doesn't map to
  -- a board unlock or a boost multiplier).
  sale_bonus := private.effective_store_sale_bonus();
  if sale_bonus > 0 then
    grant_coins := round(grant_coins * (1 + sale_bonus / 100.0));
    grant_gems  := round(grant_gems  * (1 + sale_bonus / 100.0));
  end if;

  if grant_coins > 0 then
    update public.user_wallets set coins = coins + grant_coins
    where profile_id = p_profile_id returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (p_profile_id, 'coins', grant_coins, wallet_row.coins, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider, 'sale_bonus_percent', sale_bonus), p_profile_id);
  end if;

  if grant_gems > 0 then
    update public.user_wallets set gems = gems + grant_gems
    where profile_id = p_profile_id returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (p_profile_id, 'gems', grant_gems, wallet_row.gems, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider, 'sale_bonus_percent', sale_bonus), p_profile_id);
  end if;

  if grant_board_id is not null then
    insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
    values (p_profile_id, grant_board_id, 'purchase', p_profile_id);
  end if;

  if grants_obj ? 'xpBoost' then
    insert into public.user_xp_boosts (profile_id, multiplier, expires_at, source, shop_item_id)
    values
      (p_profile_id, xp_boost_mult, now() + (xp_boost_days || ' days')::interval,
       'purchase', p_item.id);
  end if;

  insert into public.purchases
    (profile_id, product_id, product_type, provider, provider_transaction_id, price_cents, contents, status)
  values
    (p_profile_id, p_item.id, p_item.kind, p_provider, p_txn, p_item.price_cents,
     coalesce(p_item.contents, '{}'::jsonb) || jsonb_build_object('sale_bonus_percent', sale_bonus), 'completed');

  return wallet_row;
end;
$$;
revoke execute on function private.apply_shop_grants_and_record(uuid, public.shop_items, text, text) from public;

-- 5. Seed one global sale, OFF by default (operator flips it on in the BO) -----
insert into public.store_sales (label, bonus_percent, is_active)
select 'Store Sale', 50, false
where not exists (select 1 from public.store_sales);
