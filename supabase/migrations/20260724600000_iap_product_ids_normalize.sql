-- IAP product-id normalization + integrity guards.
--
-- Context: the shop was re-catalogued (coins ladder) via the BO, and the new
-- rows were saved with `google_product_id` values that are INVALID and UNSAFE
-- as Google Play product IDs:
--
--   1. Hyphens. Play product IDs may contain only lowercase letters, digits,
--      underscores and full stops (the Create-product form states this
--      explicitly). 6 of 7 distinct ids used hyphens and Play would reject them.
--
--   2. A three-way collision. `sea-of-coins` ($49.99 / 336k coins),
--      `crate-of-coins` ($79.99 / 900k) and `coin-vault` ($99.99 / 1.15M) all
--      mapped to the SAME id `coin-treasure-pack-4999`. A Play product has one
--      price and a unique id, so all three cannot exist. Worse, fulfillment
--      (validate-google-purchase -> fulfill_google_purchase) validates a token
--      against the item's google_product_id but grants by the CLIENT-supplied
--      shopItemId — so a buyer of the one real $49.99 product could claim the
--      $99.99 grant. A real-money coin-mint. This must never ship.
--
-- Fix: rewrite the ids to unique, Play-valid slugs (lowercase + underscores),
-- then add a UNIQUE index (the guard that would have caught the collision) and
-- a format CHECK (the guard that would have caught the hyphens) so neither
-- class of bug can recur via the BO. Android-only for now; apple_product_id is
-- unset and left untouched.
--
-- The Play products created in the console use these exact ids, keeping DB
-- google_product_id === Play product id so token validation resolves correctly.

begin;

-- 1. Rewrite to Play-valid, unique ids (keyed on the primary key).
update shop_items set google_product_id = 'small_coin_pack_099'     where id = 'small-coins';
update shop_items set google_product_id = 'medium_coin_pack_199'    where id = 'medium-coin-pack';
update shop_items set google_product_id = 'big_coin_pack_499'       where id = 'big-coin-pack';
-- 'starter-bundle' already carries the valid, unique id 'starter_bundle' — left as-is.
update shop_items set google_product_id = 'pile_of_coin_pack_999'   where id = 'pile-of-coins';
update shop_items set google_product_id = 'coin_treasure_pack_1999' where id = 'coin-treasure';
-- The three formerly-colliding tiers get their own ids:
update shop_items set google_product_id = 'sea_of_coins_4999'       where id = 'sea-of-coins';
update shop_items set google_product_id = 'crate_of_coins_7999'     where id = 'crate-of-coins';
update shop_items set google_product_id = 'mega_coin_vault_9999'    where id = 'coin-vault';

-- 2. Guard against a future collision (a store product id must map to at most
--    one shop item, or fulfillment is ambiguous / mintable).
create unique index if not exists shop_items_google_product_id_key
  on shop_items (google_product_id)
  where google_product_id is not null;

-- 3. Guard against a Play-invalid id being saved from the BO. Mirrors Play's
--    rule: start with a lowercase letter or digit; then lowercase letters,
--    digits, underscores or full stops. (No hyphens — that is what broke here.)
alter table shop_items
  add constraint shop_items_google_product_id_format
  check (google_product_id is null or google_product_id ~ '^[a-z0-9][a-z0-9_.]*$');

commit;
