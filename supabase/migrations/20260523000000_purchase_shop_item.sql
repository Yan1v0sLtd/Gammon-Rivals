-- Atomic gem-priced shop purchase.
--
-- Reads `shop_items.contents.grants` and dispatches each known grant key
-- into the right wallet column or inventory table. Unknown grant keys
-- raise `unsupported_grant: <key>` so we never silently fail to deliver.
--
-- Mirrors the existing public.purchase_board_with_gems pattern: SECURITY
-- DEFINER, typed exceptions, returns the post-purchase wallet row so the
-- client can update the top-bar pill immediately.
--
-- Real-money packs (price_cents) go through Apple/Google IAP in a later
-- PR and write to public.purchases. Gem-priced purchases write only to
-- wallet_transactions and the relevant inventory table.

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
  allowed_grants text[] := array['coins', 'gems', 'boardThemeId'];
  wallet_row public.user_wallets;
  grant_coins int;
  grant_gems int;
  grant_board_id text;
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

  -- Reject grants this RPC doesn't know how to fulfill so the player
  -- never gets debited for a no-op. xpBoostDays / luckyDiceUses / chests
  -- / monthlyPassDays will be added once their backing tables exist.
  for grant_key in select jsonb_object_keys(grants_obj) loop
    if not (grant_key = any(allowed_grants)) then
      raise exception 'unsupported_grant: %', grant_key;
    end if;
  end loop;

  -- Board grants are idempotent at the inventory level (PK on
  -- profile_id + board_theme_id) — but charging gems for a board the
  -- player already owns is a bad deal. Block up front.
  if grants_obj ? 'boardThemeId' then
    if exists (
      select 1 from public.user_board_inventory
      where profile_id = caller_id
        and board_theme_id = grants_obj ->> 'boardThemeId'
    ) then
      raise exception 'already_owned_board';
    end if;
  end if;

  -- Defensive: ensure a wallet row exists. The profiles_create_wallet
  -- trigger guarantees this for normal sign-ups, but doing it here
  -- means an RPC call right after profile creation can't lose to
  -- trigger ordering.
  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  -- Debit gems atomically. The `gems >= cost_gems` guard makes the
  -- UPDATE a no-op if the player can't afford it, and the lack of a
  -- returned row tells us to raise insufficient_gems.
  update public.user_wallets
  set gems = gems - cost_gems
  where profile_id = caller_id
    and gems >= cost_gems
  returning * into wallet_row;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_gems';
  end if;

  reason_label := coalesce(item_row.display_name, target_item_id);

  -- Ledger row for the debit.
  insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
  values
    (caller_id, 'gems', -cost_gems, wallet_row.gems, 'purchase',
     'Shop purchase: ' || reason_label,
     jsonb_build_object('shop_item_id', target_item_id),
     caller_id);

  -- Apply grants. Each currency grant gets its own ledger row so the
  -- audit trail clearly shows the cost and the reward separately.
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

  return wallet_row;
end;
$$;

grant execute on function public.purchase_shop_item(text) to authenticated;

comment on function public.purchase_shop_item(text) is
  'Atomically purchases a gem-priced shop item. Validates contents.grants up front, debits gems, dispatches grants (coins/gems → user_wallets, boardThemeId → user_board_inventory), logs each currency move in wallet_transactions. Returns the post-purchase wallet row. Raises: not_authenticated, item_not_found, item_disabled, item_not_gem_priced, unsupported_grant:<key>, already_owned_board, insufficient_gems.';
