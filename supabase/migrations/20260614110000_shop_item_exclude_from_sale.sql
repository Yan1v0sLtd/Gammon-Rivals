-- Per-item Store Sale opt-out. An active sale skips boosting the coin/gem grants
-- of items flagged exclude_from_sale (e.g. keep a top-tier pack off discounts).
-- Enforced in the grant core so the opt-out is server-authoritative.

alter table public.shop_items
  add column if not exists exclude_from_sale boolean not null default false;

comment on column public.shop_items.exclude_from_sale is
  'When true, an active Store Sale does NOT boost this item''s coin/gem grants.';

-- Grant core now respects the per-item opt-out. Otherwise identical to
-- 20260614100000_store_sale.sql.
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

  -- Store Sale: multiply currency grants by (1 + bonus/100), UNLESS this item
  -- opts out. Authoritative here so the opt-out can't be bypassed client-side.
  sale_bonus := private.effective_store_sale_bonus();
  if sale_bonus > 0 and not coalesce(p_item.exclude_from_sale, false) then
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
