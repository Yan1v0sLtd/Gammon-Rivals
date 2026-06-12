-- Teach purchase_shop_item how to fulfil `xpBoost` grants.
--
-- Grant shape (in shop_items.contents.grants):
--   "xpBoost": { "days": 7, "multiplier": 2 }
--
-- On success we insert a public.user_xp_boosts row with
-- expires_at = now() + days, source = 'purchase'. The player's
-- effective multiplier (max of all active rows) is read back via
-- current_xp_multiplier() inside any RPC that awards XP.
--
-- Everything else in this RPC is unchanged from
-- 20260523000000_purchase_shop_item.sql — we only:
--   1. add 'xpBoost' to allowed_grants
--   2. parse the nested object and validate days/multiplier
--   3. insert into user_xp_boosts after the gem debit + currency grants

create or replace function public.purchase_shop_item(
  target_item_id text
)
returns public.user_wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  item_row public.shop_items;
  cost_gems int;
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
  reason_label text;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into item_row from public.shop_items where id = target_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;
  if not item_row.is_enabled then
    raise exception 'item_disabled';
  end if;

  cost_gems := coalesce(item_row.price_gems, 0);
  if cost_gems <= 0 then
    raise exception 'item_not_gem_priced';
  end if;

  grants_obj := coalesce(item_row.contents -> 'grants', '{}'::jsonb);

  -- Reject grants this RPC doesn't know how to fulfill.
  for grant_key in select jsonb_object_keys(grants_obj) loop
    if not (grant_key = any(allowed_grants)) then
      raise exception 'unsupported_grant: %', grant_key;
    end if;
  end loop;

  -- Validate the xpBoost grant shape up front, before any wallet
  -- mutation. Cheaper to fail here than to debit gems and then choke
  -- on a missing field.
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
      where profile_id = caller_id
        and board_theme_id = grants_obj ->> 'boardThemeId'
    ) then
      raise exception 'already_owned_board';
    end if;
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  update public.user_wallets
  set gems = gems - cost_gems
  where profile_id = caller_id
    and gems >= cost_gems
  returning * into wallet_row;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_gems';
  end if;

  reason_label := coalesce(item_row.display_name, target_item_id);

  insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
  values
    (caller_id, 'gems', -cost_gems, wallet_row.gems, 'purchase',
     'Shop purchase: ' || reason_label,
     jsonb_build_object('shop_item_id', target_item_id),
     caller_id);

  grant_coins    := coalesce((grants_obj ->> 'coins')::int, 0);
  grant_gems     := coalesce((grants_obj ->> 'gems')::int, 0);
  grant_board_id := grants_obj ->> 'boardThemeId';

  if grant_coins > 0 then
    update public.user_wallets
    set coins = coins + grant_coins
    where profile_id = caller_id
    returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (caller_id, 'coins', grant_coins, wallet_row.coins, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', target_item_id),
       caller_id);
  end if;

  if grant_gems > 0 then
    update public.user_wallets
    set gems = gems + grant_gems
    where profile_id = caller_id
    returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (caller_id, 'gems', grant_gems, wallet_row.gems, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', target_item_id),
       caller_id);
  end if;

  if grant_board_id is not null then
    insert into public.user_board_inventory
      (profile_id, board_theme_id, source, granted_by)
    values
      (caller_id, grant_board_id, 'purchase', caller_id);
  end if;

  -- XP boost grant — append a new row rather than extending any
  -- existing one so the audit trail keeps each purchase visible.
  -- Effective multiplier is computed as max() across active rows in
  -- current_xp_multiplier(); duration is the row's own expires_at.
  if grants_obj ? 'xpBoost' then
    insert into public.user_xp_boosts
      (profile_id, multiplier, expires_at, source, shop_item_id)
    values
      (caller_id, xp_boost_mult, now() + (xp_boost_days || ' days')::interval,
       'purchase', target_item_id);
  end if;

  return wallet_row;
end;
$$;

grant execute on function public.purchase_shop_item(text) to authenticated;

comment on function public.purchase_shop_item(text) is
  'Atomically purchases a gem-priced shop item. Validates contents.grants up front, debits gems, dispatches grants (coins/gems → user_wallets, boardThemeId → user_board_inventory, xpBoost → user_xp_boosts), logs each currency move in wallet_transactions. Returns the post-purchase wallet row. Raises: not_authenticated, item_not_found, item_disabled, item_not_gem_priced, unsupported_grant:<key>, invalid_xp_boost_grant, already_owned_board, insufficient_gems.';
