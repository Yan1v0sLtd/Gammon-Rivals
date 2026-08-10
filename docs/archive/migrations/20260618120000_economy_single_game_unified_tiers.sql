-- Unified single-game economy for the difficulty tiers (+ tier-scaled win XP).
--
-- Restores the engine's documented default of single-game matches
-- (match_target = 1) and unifies the AI and PvP payouts onto ONE player-facing
-- number per tier, so an AI match is economically identical to a PvP match
-- (groundwork for matchmaking that falls back to a disguised, rating-matched AI
-- with no observable payout "tell").
--
-- Payout derivation (per tier):
--   rake   = 100 - target_rtp_pct
--   pot    = 2 * entry_fee
--   winner = pot * (1 - rake) - loser_consolation
--   prize_coins (the AI flat prize) is set to that same winner amount,
-- so at a ~50/50 opponent each tier lands exactly on its target RTP and the AI
-- flat-prize path and the PvP pot path pay identically. Validated in src/sim
-- (economy.sim.test.ts) and a rollback transaction before applying.
--
-- RTP gradient is intentionally kept generous-low / extract-high (90 -> 80):
-- the entry tier stays the friendliest for new players. The climb incentive is
-- deliberately NOT odds-based (inverting RTP would gouge newbies) — it's the
-- big absolute wins (Beginner 1,700 vs Grand Master 140,000) plus tier-scaled
-- win XP (base_xp_win 50/100/200/400/800): higher stakes level you up faster,
-- at zero house-margin cost.
--
-- AI strength FLOOR raised easy -> medium on Beginner/Advanced so a sub-1300
-- player can't farm a random ('easy') AI at the higher single-game prize.
-- Pro/Expert already floor at medium; Grand Master stays hard.
-- enter_room_ai_fallback's rating bands keep stronger players matched upward.

update public.table_configs
   set match_target = 1, prize_coins = 1700,   pvp_rake_pct = 10, ai_level = 'medium', base_xp_win = 50
 where id = 'difficulty-beginner';

update public.table_configs
   set match_target = 1, prize_coins = 4920,   pvp_rake_pct = 13, ai_level = 'medium', base_xp_win = 100
 where id = 'difficulty-advanced';

update public.table_configs
   set match_target = 1, prize_coins = 15500,  pvp_rake_pct = 15, base_xp_win = 200
 where id = 'difficulty-pro';

update public.table_configs
   set match_target = 1, prize_coins = 44700,  pvp_rake_pct = 18, base_xp_win = 400
 where id = 'difficulty-expert';

update public.table_configs
   set match_target = 1, prize_coins = 140000, pvp_rake_pct = 20, base_xp_win = 800
 where id = 'difficulty-grand-master';
