-- Seed shop_items with the Phase 1 layout so Shop.tsx can read from the DB
-- instead of the inline TOP_OFFERS / DAILY_DEALS arrays. Presentation hints
-- (placement, ribbon, headline, bonuses) live in contents.presentation; what
-- the player actually receives lives in contents.grants — that split lets
-- the Back Office reposition packs without code changes, and lets the
-- upcoming Buy RPC consume only the grants.

-- on-conflict upsert: re-running this migration (or running it after the
-- Back Office has edited a row) should refresh the seed shape but won't
-- create duplicates.

insert into public.shop_items
  (id, kind, display_name, description, sort_order, is_enabled,
   price_cents, price_gems, contents)
values
  -- =========================================================================
  -- Top Offers (USD-priced) — sort 100..199
  -- =========================================================================
  ('vault-of-gems', 'gem_pack', 'Vault of Gems',
   '10,000 gems + 50,000 coins + 10 chests',
   100, true, 9999, null,
   jsonb_build_object(
     'grants', jsonb_build_object('gems', 10000, 'coins', 50000, 'chests', 10),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', 'best-value',
       'headline', jsonb_build_object('kind', 'gems', 'label', '10,000'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'coins', 'amount', 50000),
         jsonb_build_object('kind', 'chest', 'amount', 10)
       )
     )
   )),
  ('sack-of-gems', 'gem_pack', 'Sack of Gems',
   '5,000 gems + 25,000 coins + 5 chests',
   110, true, 4999, null,
   jsonb_build_object(
     'grants', jsonb_build_object('gems', 5000, 'coins', 25000, 'chests', 5),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', 'popular',
       'headline', jsonb_build_object('kind', 'gems', 'label', '5,000'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'coins', 'amount', 25000),
         jsonb_build_object('kind', 'chest', 'amount', 5)
       )
     )
   )),
  ('bowl-of-gems', 'gem_pack', 'Bowl of Gems',
   '2,500 gems + 10,000 coins',
   120, true, 2499, null,
   jsonb_build_object(
     'grants', jsonb_build_object('gems', 2500, 'coins', 10000),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', null,
       'headline', jsonb_build_object('kind', 'gems', 'label', '2,500'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'coins', 'amount', 10000)
       )
     )
   )),
  ('coin-stack', 'coin_pack', 'Coin Stack',
   '100,000 coins + 1,000 gems',
   130, true, 1999, null,
   jsonb_build_object(
     'grants', jsonb_build_object('coins', 100000, 'gems', 1000),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', null,
       'headline', jsonb_build_object('kind', 'coins', 'label', '100,000'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'gems', 'amount', 1000)
       )
     )
   )),
  ('xp-boost-7d', 'special_offer', 'XP Boost (7 Days)',
   '7 days of double XP + 500 gems',
   140, true, 1499, null,
   jsonb_build_object(
     'grants', jsonb_build_object('xpBoostDays', 7, 'gems', 500),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', null,
       'headline', jsonb_build_object('kind', 'xp-boost', 'label', 'XP BOOST (7D)', 'subLabel', '7 Days'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'gems', 'amount', 500)
       )
     )
   )),
  ('lucky-dice-pack', 'special_offer', 'Lucky Dice Pack',
   'Lucky dice charges + 300 gems',
   150, true, 999, null,
   jsonb_build_object(
     'grants', jsonb_build_object('luckyDiceUses', 10, 'gems', 300),
     'presentation', jsonb_build_object(
       'placement', 'top_offer',
       'ribbon', null,
       'headline', jsonb_build_object('kind', 'lucky-dice', 'label', 'LUCKY DICE PACK'),
       'bonuses', jsonb_build_array(
         jsonb_build_object('kind', 'gems', 'amount', 300)
       )
     )
   )),

  -- =========================================================================
  -- Daily Deals (gem-priced) — sort 200..299
  -- =========================================================================
  ('daily-deal-gems', 'gem_pack', 'Pile of Gems',
   '200 gems',
   200, true, null, 150,
   jsonb_build_object(
     'grants', jsonb_build_object('gems', 200),
     'presentation', jsonb_build_object(
       'placement', 'daily_deal',
       'headline', jsonb_build_object('kind', 'gems', 'label', '200')
     )
   )),
  ('daily-deal-coins', 'coin_pack', 'Stack of Coins',
   '5,000 coins',
   210, true, null, 120,
   jsonb_build_object(
     'grants', jsonb_build_object('coins', 5000),
     'presentation', jsonb_build_object(
       'placement', 'daily_deal',
       'headline', jsonb_build_object('kind', 'coins', 'label', '5,000')
     )
   )),
  ('daily-deal-xp', 'special_offer', 'XP Boost (3 Days)',
   '3 days of double XP',
   220, true, null, 250,
   jsonb_build_object(
     'grants', jsonb_build_object('xpBoostDays', 3),
     'presentation', jsonb_build_object(
       'placement', 'daily_deal',
       'headline', jsonb_build_object('kind', 'xp-boost', 'label', '3 Days')
     )
   )),
  ('daily-deal-dice', 'special_offer', 'Lucky Dice',
   '2 lucky dice charges',
   230, true, null, 200,
   jsonb_build_object(
     'grants', jsonb_build_object('luckyDiceUses', 2),
     'presentation', jsonb_build_object(
       'placement', 'daily_deal',
       'headline', jsonb_build_object('kind', 'lucky-dice', 'label', 'x2')
     )
   )),

  -- =========================================================================
  -- Monthly Pass (USD-priced banner) — sort 300
  -- =========================================================================
  ('monthly-gem-pass', 'special_offer', 'Monthly Gem Pass',
   'Claim 150 gems every day for 30 days!',
   300, true, 999, null,
   jsonb_build_object(
     'grants', jsonb_build_object('monthlyPassDays', 30, 'dailyGems', 150),
     'presentation', jsonb_build_object(
       'placement', 'monthly_pass'
     )
   ))
on conflict (id) do update
  set kind        = excluded.kind,
      display_name = excluded.display_name,
      description = excluded.description,
      sort_order  = excluded.sort_order,
      is_enabled  = excluded.is_enabled,
      price_cents = excluded.price_cents,
      price_gems  = excluded.price_gems,
      contents    = excluded.contents,
      updated_at  = now();
