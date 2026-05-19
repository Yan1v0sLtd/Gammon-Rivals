-- Re-shape the XP-boost shop items now that purchase_shop_item knows
-- how to fulfil `xpBoost` grants.
--
-- Old shape (forward-declared, unsupported until now):
--   "grants": { "xpBoostDays": 7, "gems": 500 }
-- New shape (fulfilled by 20260525_purchase_shop_item_xp_boost):
--   "grants": { "xpBoost": { "days": 7, "multiplier": 2 }, "gems": 500 }
--
-- Multiplier choices for v1:
--   * xp-boost-7d   — premium ($14.99) → ×3 multiplier, 7 days
--   * daily-deal-xp — gem-priced daily → ×2 multiplier, 3 days
--
-- Both items keep their kind/price/headline. Only contents changes, so
-- the UI (which reads display_name + presentation) keeps rendering the
-- existing cards. We bump description to reflect the multiplier so the
-- Back Office row is self-explanatory.

update public.shop_items
set
  description = '7 days of ×3 XP + 500 gems',
  contents = jsonb_build_object(
    'grants', jsonb_build_object(
      'xpBoost', jsonb_build_object('days', 7, 'multiplier', 3),
      'gems', 500
    ),
    'presentation', jsonb_build_object(
      'placement', 'top_offer',
      'ribbon', null,
      'headline', jsonb_build_object(
        'kind', 'xp-boost',
        'label', 'XP BOOST (7D)',
        'subLabel', '×3 · 7 Days'
      ),
      'bonuses', jsonb_build_array(
        jsonb_build_object('kind', 'gems', 'amount', 500)
      )
    )
  ),
  updated_at = now()
where id = 'xp-boost-7d';

update public.shop_items
set
  description = '3 days of ×2 XP',
  contents = jsonb_build_object(
    'grants', jsonb_build_object(
      'xpBoost', jsonb_build_object('days', 3, 'multiplier', 2)
    ),
    'presentation', jsonb_build_object(
      'placement', 'daily_deal',
      'headline', jsonb_build_object('kind', 'xp-boost', 'label', '×2 · 3 Days')
    )
  ),
  updated_at = now()
where id = 'daily-deal-xp';
