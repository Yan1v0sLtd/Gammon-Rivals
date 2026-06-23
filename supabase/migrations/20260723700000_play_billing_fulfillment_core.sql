-- Play Billing — P1: server fulfillment core.
--
-- The inner layer of real-money IAP. Flow (built in later phases):
--   app buys on Play -> gets a purchase token -> our edge function verifies that
--   token with Google's Play Developer API -> calls fulfill_google_purchase here.
--
-- This function is the ONLY thing that turns a verified Google purchase into a
-- grant, and it is locked to service_role so a player can never call it to
-- grant themselves a purchase (the edge function, which holds the service key,
-- calls it only AFTER Google confirms the token). It funnels into the existing
-- grant core (private.apply_shop_grants_and_record) so coins/gems/boards/xpBoost
-- and the purchases ledger all behave exactly like every other purchase path.

-- 1. Idempotency: a given Google purchase token grants EXACTLY once. Google can
--    deliver the same token more than once (client retries, Real-time Developer
--    Notifications), so the token is the dedupe key. Partial index: in-game
--    purchases (gems/coins) write a NULL token and are excluded.
create unique index if not exists purchases_provider_txn_uniq
  on public.purchases (provider, provider_transaction_id)
  where provider_transaction_id is not null;

-- 2. Fulfillment RPC — service_role only. Dedupes on the token, then grants via
--    the shared core. Deliberately does NOT run the pre-payment eligibility gate
--    (assert_shop_item_purchasable): the charge already happened on Google's
--    side, so we always honour it even if the offer was since disabled/expired.
create or replace function public.fulfill_google_purchase(
  p_profile_id uuid,
  p_item_id text,
  p_purchase_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.shop_items;
  wallet_row public.user_wallets;
  existing_profile uuid;
begin
  if p_profile_id is null or p_item_id is null or coalesce(p_purchase_token, '') = '' then
    raise exception 'missing_args';
  end if;

  select * into item_row from public.shop_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;

  -- Already fulfilled? Return the current wallet without re-granting.
  select profile_id into existing_profile
  from public.purchases
  where provider = 'google' and provider_transaction_id = p_purchase_token
  limit 1;
  if found then
    select * into wallet_row from public.user_wallets where profile_id = existing_profile;
    return jsonb_build_object(
      'status', 'already_fulfilled',
      'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
    );
  end if;

  begin
    wallet_row := private.apply_shop_grants_and_record(p_profile_id, item_row, 'google', p_purchase_token);
  exception when unique_violation then
    -- A concurrent fulfilment of the same token won the race; treat as done.
    select * into wallet_row from public.user_wallets where profile_id = p_profile_id;
    return jsonb_build_object(
      'status', 'already_fulfilled',
      'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
    );
  end;

  return jsonb_build_object(
    'status', 'granted',
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
  );
end;
$$;

-- Lock it down: ONLY the edge function (service_role) may fulfill. Never players.
revoke execute on function public.fulfill_google_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_google_purchase(uuid, text, text) to service_role;

comment on function public.fulfill_google_purchase(uuid, text, text) is
  'service_role-only. Turns a Google-verified purchase token into a grant via private.apply_shop_grants_and_record (provider=google). Idempotent on the token (one grant per token). The validating edge function calls this AFTER Google confirms the token; players cannot call it.';
