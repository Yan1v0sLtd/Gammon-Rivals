-- Seed two example Featured-Pack bundles so the redesigned Store has content
-- to render. kind='bundle' + contents.presentation.placement='featured' is how
-- the storefront routes an item into the Featured Packs column. Grants are
-- limited to currently-supported types (coins/gems/xpBoost) so they're actually
-- purchasable. These are placeholders — the operator will edit/replace them
-- once the BO bundle editor lands (Shop Phase B).
insert into public.shop_items (id, kind, display_name, description, price_cents, contents, is_enabled, sort_order)
values
('starter-bundle','bundle','Starter Bundle','A head-start boost of coins and gems.',499,
 '{"grants":{"coins":25000,"gems":500},"presentation":{"placement":"featured","ribbon":"popular","headlineKind":"coins","rewards":[{"kind":"coins","label":"25,000"},{"kind":"gems","label":"500"}]}}'::jsonb,
 true, 40),
('mega-bundle','bundle','Mega Bundle','Best value — a huge pile plus a 7-day XP boost.',4999,
 '{"grants":{"coins":250000,"gems":5000,"xpBoost":{"days":7,"multiplier":2}},"presentation":{"placement":"featured","ribbon":"best-value","headlineKind":"gems","rewards":[{"kind":"coins","label":"250,000"},{"kind":"gems","label":"5,000"},{"kind":"xp","label":"2x · 7d"}]}}'::jsonb,
 true, 50)
on conflict (id) do update set
  kind = excluded.kind, display_name = excluded.display_name, description = excluded.description,
  price_cents = excluded.price_cents, contents = excluded.contents,
  is_enabled = excluded.is_enabled, sort_order = excluded.sort_order;
