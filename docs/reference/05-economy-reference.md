# Economy Reference

> Reference · As-built · Owner: Yaniv · Compiled as-of: 2026-08-10

Describes value flow: currencies, tiers, payouts, XP/rating, return rewards,
shop, and Play Billing. It does not restate mission internals — see
`docs/reference/02-daily-missions-reference.md` for mission rewards.

## 1. Scope and audience

For developers and operators tuning the economy. The headless sim
(`packages/sim/`) is the pure model; live values live in `table_configs` and
related config tables.

## 2. Currencies and wallets

- Two in-game currencies: **coins** (play currency) and **gems** (premium).
  Wallet is `public.user_wallets` with `coins`/`gems` columns, credited
  atomically. (`20260521000000_claim_daily_bonus.sql`)
- Dollar anchoring (documented, not enforced in code): 1 coin = $0.0001 (10,000
  coins per $0.99 bundle) and 1 gem = $0.05 design value.
  (`20260629000000_economy_phase2_pvp_rake_and_tier_retune.sql` header) USD rates
  are data: `packages/shared/src/currency.ts` builds a `CurrencyRateMap` from
  `currency_configs` (`usd_value_micros`), drops disabled currencies, and
  `usdMicrosFor()` returns 0 for XP. Used only for BO dollar math; the client
  wallet never sees USD. (`currency.ts:10-27`)
- Ledger: every credit/debit writes `wallet_transactions` with a constrained
  `source` set: `admin_adjustment, match_reward, purchase, daily_bonus,
level_reward, refund, system, entry_fee` plus `wheel_spin`.
  (`20260618000000_wallet_transactions_wheel_spin_source.sql`)
- No real-money cash-out: purchases are one-way grants; refunds are not handled
  (section 8).

## 3. Difficulty tiers, entry fees, payout and rake flow

- Tier table is `public.table_configs` (kind `difficulty`); the client reads it
  live and renders five cards in `DifficultyModal.tsx` (Beginner/Advanced/Pro/
  Expert/Grand Master, each with entry fee, XP boost %, time-to-move,
  `required_level` gate). (`apps/game/src/features/lobby/lobbyData.ts:265-281`;
  `DifficultyModal.tsx:252-401`)
- Pure payout math lives in `packages/sim/src/economy.ts`:
  - `aiRtp()` = (p·prizeWin + (1−p)·prizeLoss) / entryFee. (`economy.ts:30-33`)
  - `pvpWinnerPrize()` = pot − rake − loser consolation, pot = 2·fee, rake
    rounded from pot·pct. (`economy.ts:36-40`)
  - `pvpRtp()`, `aiHouseCoinsPerMatch()`. (`economy.ts:42-56`)
- Live tier snapshot (dated 2026-06-18, single-game unification) in
  `packages/sim/src/tiers.ts:23-29`: Beginner 1,000 fee / 1,700 win / 100 loss /
  rake 10 / target RTP 90%; Advanced 3,000 / 4,920 / 300 / 13 / 87; Pro 10,000 /
  15,500 / 1,500 / 15 / 85; Expert 30,000 / 44,700 / 4,500 / 18 / 82; Grand
  Master 100,000 / 140,000 / 20,000 / 20 / 80. All `matchTarget: 1` (single
  game). These match migration `20260618120000_economy_single_game_unified_tiers.sql`.
- `proposedRetune()` derives `rakePct = 100 − targetRtpPct`, `prizeWin =
pot·(1−rake) − prizeLoss`, so the AI flat prize and PvP pot land identically at
  50/50. (`tiers.ts:40-47`)
- Entry-fee debit is server-side and atomic: `enter_room` validates tier
  enabled/mode/level, debits `entry_fee_coins` only if `coins >= fee`, writes an
  `entry_fee` ledger row, creates the `matches` row.
  (`20260529000000_enter_room.sql`) PvP matchmaking debits both players' fees and
  refunds the caller if the partner is broke. (`20260710000000_economy_p0_gate_match_reward_on_paid_entry.sql`)
- Payout at finish (server RPC `finish_match`/`grant_match_reward`, consolidated
  in `20260714000000_finish_match_derive_payout.sql`):
  - vs-AI: `prize_coins` on win, `prize_coins_loss` on loss; **risk-free
    refund** — first 10 difficulty AI matches refund the entry fee when
    loss-prize < fee (`risk_free_applied`).
  - PvP: `pot = 2·entry_fee`; `rake = pot·pvp_rake_pct/100` (house); `loser =
prize_coins_loss` (no risk-free in PvP); `winner = pot − rake − loser`,
    clamped ≥ 0.
  - Abandoners get 0 coins but still take the XP/rating movement.
  - **P0 security gate:** payout and ELO only fire when `matches.entry_fee_paid_at`
    is set by an entry RPC — a client-forged match row pays nothing.
  - PvP payout no longer trusts the client winner: `commit_turn_server` calls
    `grant_match_reward` with the server-derived winner on match end.

## 4. XP, levels, status, rating

- XP earned per match: `xp = (base_xp_win · (100 + xp_multiplier_pct) / 100) ·
current_xp_multiplier(profile)`. `base_xp_win` per tier is 50/100/200/400/800.
  (`20260714000000_finish_match_derive_payout.sql`;
  `20260618120000_economy_single_game_unified_tiers.sql`)
- XP boosts (purchasable): `user_xp_boosts` (multiplier, `expires_at`);
  `current_xp_multiplier()` reads it. (`20260524000000_user_xp_boosts.sql`)
- Level auto-promotion is a BEFORE-UPDATE trigger on `profiles.xp`: finds highest
  enabled `level_configs` level whose `xp_required` is met, mutates `NEW.level`,
  and credits summed `reward_coins`/`reward_gems` for every level crossed, logged
  as `level_reward`. (`20260620000000_auto_promote_level.sql`) Client-side
  derivation in `packages/shared/src/progression.ts`.
- Status/rank labels derive from `level_status_tiers` ranges via
  `resolveStatusLabel()`, falling back to legacy `status_label`, then `'Rookie'`.
  (`progression.ts:76-104`)
- Rating: `profiles.pvp_rating`, ELO K=32, defaults to 1500, clamped 0–4000; both
  sides move on any decisive paid PvP match, abandonment counts as a loss.
  (`20260610000000_finish_match_pvp_penalty_elo.sql`) PvP matchmaking pairs
  within a rating band (default 200).

## 5. Return rewards: daily bonus, hourly wheel

- **Daily bonus:** `claim_daily_bonus()` RPC. Rolls over at midnight
  America/New_York; 7-day streak from `daily_bonus_configs` cycling day 7 → 1;
  streak resets to day 1 after a missed day; `already_claimed` guard with a row
  lock; credits coins+gems (ledger `daily_bonus`) and XP.
  (`20260521000000_claim_daily_bonus.sql`)
- **Hourly wheel:** `wheel_configs` (cooldown_seconds default 3600, clamped
  300..604800), `wheel_slots` (up to 32 slots, 10 seeded; `chance_basis_points`
  integer, enabled slots must sum to exactly 10000). `spin_wheel` is
  server-authoritative: cooldown gate, weighted pick, per-type credit CASE
  (coins/gems/xp), ledger source `wheel_spin`, records in `user_wheel_spins`.
  (`20260617000000_hourly_wheel.sql`) Seeded EV is intentionally not balanced
  (deferred operator tuning — section 9).

## 6. Shop catalog, sales, board purchases

- Catalog source of truth is `shop_items` (BO-managed); the client maps rows via
  `mapShop()` into featured `bundles` and a `packs` grid (kinds: coin_pack,
  gem_pack, board_theme, cosmetic, special_offer). Rewards/grants live in
  `contents.grants` (`coins`, `gems`, `boardThemeId`, `xpBoost`). Prices are
  `price_cents` (USD) or `price_gems`. (`apps/game/src/modals/Shop/shopCatalog.ts:60-194`)
- Buy flow (`useShopPurchase.ts`): **gem path** → `purchase_shop_item` RPC
  (server-priced, atomic gem debit, eligibility + per-user cap); **USD path** →
  `getBilling().purchase()` (section 7). Error codes matched by the UI:
  `unsupported_grant`, `insufficient_gems`, `already_owned_board`,
  `purchase_limit_reached`. (`useShopPurchase.ts:88-108`)
- Grant core: `private.apply_shop_grants_and_record` validates the grant
  allowlist, applies coins/gems → wallet, `boardThemeId` → `user_board_inventory`,
  `xpBoost` → `user_xp_boosts`, and writes the `purchases` row (provider
  `gems`/`test`/`google`/…). An admin-only `test_purchase_shop_item` bypasses
  eligibility and records `provider='test'`.
  (`20260613000000_shop_purchase_core_and_test.sql`)
- **Sales:** one global `store_sales` row; while active+in-window, the grant core
  multiplies **currency** grants by `(1 + bonus/100)` server-side (boards/xpBoost
  unscaled). (`20260614100000_store_sale.sql`)
- Board purchases also exist as a dedicated gem RPC `purchase_board_with_gems`.
  (`20260519000000_purchase_board_with_gems.sql`)

## 7. Google Play Billing: validation and grant path

- Client: `NativeBillingService` registers every enabled
  `shop_items.google_product_id` as CONSUMABLE (SKU list is DATA, not hardcoded),
  arms a per-SKU pending resolver, calls `offer.order()`, and sets
  `store.validator` to POST `{shopItemId, purchaseToken}` with the buyer's
  Supabase JWT to the `validate-google-purchase` edge fn. On
  `granted`/`already_fulfilled` the verified handler `finish()`es and resolves
  `{status:'granted'}`. Web builds use `MockBillingService` →
  `{status:'error', code:'not_authorized'}`. (`apps/game/src/lib/billing/nativeBilling.ts`)
- Edge fn `validate-google-purchase/index.ts`: JWT → `profile_id` (identity from
  token, not body) → resolve `google_product_id` → self-signed JWT to Google
  OAuth (service account `GOOGLE_SERVICE_ACCOUNT_JSON`, scope `androidpublisher`)
  → Play Developer API with `purchaseState === 0` → calls
  `fulfill_google_purchase`. `billing_not_configured` → 503. (`index.ts:150-196`)
- Grant: `fulfill_google_purchase` is **service_role-only** and **idempotent on
  the purchase token** (unique partial index `(provider, provider_transaction_id)`),
  funnels through the shared grant core with provider `google`. It deliberately
  skips the pre-payment eligibility gate — a charge that happened must be honored
  even if the offer is since disabled. (`20260723700000_play_billing_fulfillment_core.sql`)
- Play product-ID integrity: migration `20260724600000_iap_product_ids_normalize.sql`
  fixed a three-way SKU collision that would have let a $49.99 buyer claim a
  $99.99 grant, added a UNIQUE index and a Play-format CHECK on
  `google_product_id`. 9 coin-ladder products now live.

## 8. Economy monitoring and RTP reporting

- BO dashboard: `get_rtp_summary(p_since)` — admin-only aggregation per
  difficulty tier: matches played/won, actual win rate, coins wagered (sum of
  `entry_fee` debits), coins paid out (`match_reward` credits), house net,
  **actual RTP % = paid_out/wagered**, `rtp_delta_pct` vs `target_rtp_pct`, and
  risk-free payout count. Time-windowed (24h/7d/30d/all).
  (`20260604000000_rtp_summary_rpc.sql`) Consumed by
  `apps/admin/src/features/RTPAnalytics/`, which also calls `get_rtp_per_player`.
- Headless sim: `pnpm run sim` → `packages/sim/src/runSim.ts` prints the economy
  RTP report (current vs proposed across pWin 0.4–0.65 per tier, with
  house-per-match), the AI strength ladder, and the softmax rating-match
  calibration sweep. `SIM_GAMES` env controls sample size. Sanity checks assert
  pip counts, valid outcomes, the AI-flat == PvP-pot invariant, and RTP within
  1.0 of target. (`runSim.ts:37-100`)
- The sim is a **snapshot model**: `tiers.ts` reproduces live `table_configs`
  values as pure data and must be re-queried when the live config changes.
  (`tiers.ts:1-13`)
- See `docs/reference/06-admin-reference.md` for the operator RTP reporting
  workflow.

## 9. Known gaps

- **Unverified device purchase:** `NativeBillingService` is a "first draft" — the
  plugin lifecycle still needs an on-device test-license buy to confirm.
  (`apps/game/src/lib/billing/service.ts:21`) Remaining steps: build release AAB
  - on-device test buy. See `docs/runbooks/03-play-billing-release.md`.
- **No refund/chargeback handling:** explicitly deferred to P4 (Real-time
  Developer Notifications). (`validate-google-purchase/index.ts:9-10`)
- **Client-trust remaining:** HotSeat AI `finish_match` still trusts the client
  winner (AI moves are not yet server-authored), and the forfeit path lacks
  server-side abandonment verification.
  (`20260714000000_finish_match_derive_payout.sql`)
- **TEMP debug writes:** edge fn failure reasons are mirrored into
  `billing_debug_log` ("TEMP debug … Remove once diagnosed").
  (`validate-google-purchase/index.ts:171,184`)
- **Snapshot drift risk:** `tiers.ts` is a live-config snapshot (2026-06-18) but
  `20260629000000_economy_phase2_pvp_rake_and_tier_retune.sql` (2026-06-29)
  re-seeded the same rows with different vs-AI numbers. The sim "current" numbers
  may no longer match the live `table_configs`.
- Wheel EV is not economy-tuned in code (section 9 open decisions).

## 10. Open decisions

- **Unified single-game retune (Tasks #148/#149):** `proposedRetune()` unifies AI
  flat prize and PvP pot onto one payout per tier at 50/50; runSim asserts
  AI-flat == PvP-pot and target RTP at p=0.5. Whether the unified derivation is
  the live source of truth is unresolved (see section 9 snapshot drift).
- **Daily Bonus retune / Hourly Wheel EV / Mission Chests / level extension /
  board pricing** were explicitly deferred ("operator will tune").
  (`20260629000000_economy_phase2_pvp_rake_and_tier_retune.sql` header)
- **PvP rake is per-tier and data-driven** (`pvp_rake_pct` column), explicitly to
  allow future "no-rake weekends" without code changes.
- **Refund/chargeback handling (P4 RTDN)** and **server-authored AI games (layer 2)** are named future phases.
