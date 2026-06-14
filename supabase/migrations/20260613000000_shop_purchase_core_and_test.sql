-- Shop purchase core + test-purchase path + server-side limit enforcement.
--
-- Why: gem purchases bypassed the `purchases` table, so max_purchases_per_user
-- and the starts_at/ends_at schedule window were display-only (honor system).
-- This introduces a single grant core that every purchase path funnels through
-- — gem purchases now, test purchases now, real-money (Play Billing / Stripe)
-- later — so eligibility is enforced in exactly one place and every purchase is
-- recorded for the per-user cap to count against.

-- 1. Let in-game-currency purchases be recorded in `purchases` so the per-user
--    cap has a ledger to count. (Real money already had apple/google/stripe.)
alter table public.purchases drop constraint purchases_provider_check;
alter table public.purchases add constraint purchases_provider_check
  check (provider = any (array['apple','google','stripe','admin','test','gems','coins']));

-- 2. Eligibility gate — run BEFORE taking payment. Enforces enabled + schedule
--    window + per-user cap. The cap counts only real/paid completed purchases
--    (provider <> 'test') so test-buying never locks a tester out of an item.
create or replace function private.assert_shop_item_purchasable(
  p_profile_id uuid,
  p_item public.shop_items
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prior_count int;
begin
  if not p_item.is_enabled then
    raise exception 'item_disabled';
  end if;
  if p_item.starts_at is not null and now() < p_item.starts_at then
    raise exception 'item_not_yet_available';
  end if;
  if p_item.ends_at is not null and now() > p_item.ends_at then
    raise exception 'item_expired';
  end if;
  if p_item.max_purchases_per_user is not null then
    select count(*) into prior_count
    from public.purchases
    where profile_id = p_profile_id
      and product_id = p_item.id
      and status = 'completed'
      and provider <> 'test';
    if prior_count >= p_item.max_purchases_per_user then
      raise exception 'purchase_limit_reached';
    end if;
  end if;
end;
$$;
revoke execute on function private.assert_shop_item_purchasable(uuid, public.shop_items) from public;

-- 3. Grant + record core — run AFTER payment is confirmed (gem debit done, or
--    receipt/webhook validated, or test gate passed). Validates the grant
--    allowlist, applies grants (coins/gems → wallet, board → inventory, xpBoost
--    → user_xp_boosts), and writes the `purchases` row. Returns the post-grant
--    wallet. The whole thing runs inside the caller's transaction, so any raise
--    rolls back the payment too.
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

  if grant_coins > 0 then
    update public.user_wallets set coins = coins + grant_coins
    where profile_id = p_profile_id returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (p_profile_id, 'coins', grant_coins, wallet_row.coins, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider), p_profile_id);
  end if;

  if grant_gems > 0 then
    update public.user_wallets set gems = gems + grant_gems
    where profile_id = p_profile_id returning * into wallet_row;
    insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values
      (p_profile_id, 'gems', grant_gems, wallet_row.gems, 'purchase',
       'Shop grant: ' || reason_label,
       jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider), p_profile_id);
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
     coalesce(p_item.contents, '{}'::jsonb), 'completed');

  return wallet_row;
end;
$$;
revoke execute on function private.apply_shop_grants_and_record(uuid, public.shop_items, text, text) from public;

-- 4. Gem purchase — now enforces eligibility (the integrity fix) and records
--    the purchase via the shared core. Behaviour is otherwise unchanged:
--    server-priced from price_gems, atomic gem debit, same grant set.
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
  wallet_row public.user_wallets;
  reason_label text;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into item_row from public.shop_items where id = target_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;

  cost_gems := coalesce(item_row.price_gems, 0);
  if cost_gems <= 0 then
    raise exception 'item_not_gem_priced';
  end if;

  -- enabled / schedule window / per-user cap — before taking gems.
  perform private.assert_shop_item_purchasable(caller_id, item_row);

  insert into public.user_wallets (profile_id) values (caller_id)
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
     jsonb_build_object('shop_item_id', target_item_id), caller_id);

  -- Grants + purchases-row in the shared core (provider 'gems').
  return private.apply_shop_grants_and_record(caller_id, item_row, 'gems', null);
end;
$$;
grant execute on function public.purchase_shop_item(text) to authenticated;

comment on function public.purchase_shop_item(text) is
  'Atomically purchases a gem-priced shop item: enforces enabled/schedule/per-user-cap (private.assert_shop_item_purchasable), debits gems, then applies grants + records the purchase via private.apply_shop_grants_and_record (provider=gems). Returns the post-purchase wallet. Raises: not_authenticated, item_not_found, item_not_gem_priced, item_disabled, item_not_yet_available, item_expired, purchase_limit_reached, insufficient_gems, unsupported_grant:<key>, invalid_xp_boost_grant, already_owned_board.';

-- 5. Test purchase — admin-only, no payment. Grants any item's contents and
--    records a provider='test' purchase so the full flow (grant → wallet/
--    inventory → ledger → UI) can be exercised before real billing exists.
--    Deliberately BYPASSES the eligibility gate so a draft/disabled/scheduled
--    offer can be validated; provider='test' rows never count toward the cap.
create or replace function public.test_purchase_shop_item(
  p_item_id text,
  p_target_profile_id uuid default null
)
returns public.user_wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  target_id uuid;
  item_row public.shop_items;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.can_manage_config(caller_id) then
    raise exception 'not_authorized';
  end if;

  target_id := coalesce(p_target_profile_id, caller_id);

  select * into item_row from public.shop_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;

  return private.apply_shop_grants_and_record(
    target_id, item_row, 'test', 'test:' || gen_random_uuid()::text
  );
end;
$$;
revoke execute on function public.test_purchase_shop_item(text, uuid) from public, anon;
grant execute on function public.test_purchase_shop_item(text, uuid) to authenticated;

comment on function public.test_purchase_shop_item(text, uuid) is
  'Admin-only (private.can_manage_config) test purchase: grants a shop item to the target (default caller) with NO payment, recorded as provider=test. Bypasses the eligibility gate so draft offers can be validated; test rows do not count toward max_purchases_per_user. Reuses the same grant core as real purchases. Raises: not_authenticated, not_authorized, item_not_found, and the same grant errors as purchase_shop_item.';