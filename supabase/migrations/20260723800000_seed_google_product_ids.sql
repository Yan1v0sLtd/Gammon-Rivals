-- Map each real-money shop item to its Google Play product ID (SKU). Play
-- product IDs allow [a-z0-9_] (no hyphens), so we derive them from the item id
-- with hyphens -> underscores: small-coins -> small_coins. These are the exact
-- IDs to create as in-app products in Play Console; the validation edge function
-- looks the SKU up from shop_items.google_product_id, so once they match here +
-- in the console, fulfillment routes to the right grant automatically.
--
-- NOTE: monthly-gem-pass is a 30-day pass — decide one-time vs auto-renewing
-- SUBSCRIPTION before creating it (subscriptions use a different Play product
-- type + validation API). The ID is mapped here either way.
update public.shop_items
set google_product_id = replace(id, '-', '_'),
    updated_at = now()
where price_cents is not null
  and google_product_id is null;
