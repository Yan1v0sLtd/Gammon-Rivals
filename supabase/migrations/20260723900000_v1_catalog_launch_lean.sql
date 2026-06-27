-- v1 IAP catalog: make every ENABLED real-money product fulfillment-ready.
--
-- The grant core only grants coins / gems / boardThemeId / xpBoost. Four products
-- referenced not-yet-built mechanics (chests / luckyDiceUses / dailyGems +
-- monthlyPassDays) and would fail at fulfillment, and small-coins granted
-- nothing. Per the launch-lean decision: fix small-coins and disable the four
-- until their mechanics ship (re-enable then).

-- small-coins ($0.99): grant 10,000 coins (was empty).
update public.shop_items
set contents = jsonb_set(coalesce(contents, '{}'::jsonb), '{grants}', '{"coins": 10000}'::jsonb),
    updated_at = now()
where id = 'small-coins';

-- Disable the products whose grant mechanics aren't implemented yet. They keep
-- their google_product_id mapping for when they return.
update public.shop_items
set is_enabled = false, updated_at = now()
where id in ('sack-of-gems', 'vault-of-gems', 'lucky-dice-pack', 'monthly-gem-pass');
