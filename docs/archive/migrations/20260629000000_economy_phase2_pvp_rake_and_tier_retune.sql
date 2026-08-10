-- Economy Phase 2 — dollar-anchored tier retune + explicit PvP rake.
--
-- Anchors locked in the chat: 1 coin = $0.0001 (10,000 coins per $0.99
-- bundle, ~10 Beginner games per dollar); 1 gem = $0.05 design-value
-- (no direct sale yet); 3x tier progression so even GM is reachable.
-- vs-AI RTP walks 90% → 80% as stakes climb. PvP takes a flat 10%
-- house rake; the losing player still gets the same lose-prize they
-- would in a vs-AI match (no risk-free refund — PvP losses are
-- decisive but consoled).
--
-- This migration touches two things:
--
-- 1. ADD COLUMN public.table_configs.pvp_rake_pct.
--    Stored per tier so operators can later run "no-rake weekends"
--    on a single tier without code changes. finish_match (v4 below)
--    reads it to compute the PvP winner prize from the pot:
--      rake     = pot * pvp_rake_pct / 100
--      loser    = prize_coins_loss            (same as vs-AI table)
--      winner   = pot - rake - loser
--    The vs-AI columns (prize_coins, prize_coins_loss) remain the
--    source of truth for AI matches; the PvP winner prize is
--    derived, not stored, so changing rake or lose-prize updates
--    both sides without a schema migration.
--
-- 2. RE-SEED the 5 'difficulty' rows in public.table_configs with
--    the dollar-anchored entry fees and the per-tier RTP curve.
--    The on-conflict upsert in the original seed migration means
--    re-running 20260528 would wipe these — that migration won't be
--    re-run in prod, so the updates here become the long-lived
--    source of truth.
--
-- Out of scope (deferred per chat): Daily Bonus retune (BO already
-- handles recursive 7-day), Hourly Wheel EV (operator will tune),
-- Mission Chests (feature disabled in client UI; see lobbyData
-- change in this changeset), level system extension (separate
-- design discussion), board theme pricing (BO).

alter table public.table_configs
  add column pvp_rake_pct int not null default 10
    check (pvp_rake_pct between 0 and 100);

comment on column public.table_configs.pvp_rake_pct is
  'House rake (percent of total pot) applied to PvP matches. finish_match derives winner_prize = pot - rake - prize_coins_loss; the loser still receives prize_coins_loss. The vs-AI payout columns (prize_coins, prize_coins_loss) are independent.';

-- Re-seed Beginner — 1,000 entry / 1,200 win / 200 lose / 90% RTP.
update public.table_configs
set entry_fee_coins  = 1000,
    prize_coins      = 1200,
    prize_coins_loss = 200,
    pvp_rake_pct     = 10,
    target_rtp_pct   = 90,
    updated_at = now()
where id = 'difficulty-beginner';

-- Re-seed Advanced — 3,000 entry / 4,200 win / 200 lose / 87% RTP.
-- Lose-prize stays small so wins feel meaningfully better; the RTP
-- target accounts for the 60% win rate assumption.
update public.table_configs
set entry_fee_coins  = 3000,
    prize_coins      = 4200,
    prize_coins_loss = 200,
    pvp_rake_pct     = 10,
    target_rtp_pct   = 87,
    updated_at = now()
where id = 'difficulty-advanced';

-- Re-seed Pro — 10,000 entry / 15,000 win / 2,000 lose / 85% RTP.
-- 50/50 inflection — house edge widens to 15%.
update public.table_configs
set entry_fee_coins  = 10000,
    prize_coins      = 15000,
    prize_coins_loss = 2000,
    pvp_rake_pct     = 10,
    target_rtp_pct   = 85,
    updated_at = now()
where id = 'difficulty-pro';

-- Re-seed Expert — 30,000 entry / 54,000 win / 5,400 lose / 82% RTP.
update public.table_configs
set entry_fee_coins  = 30000,
    prize_coins      = 54000,
    prize_coins_loss = 5400,
    pvp_rake_pct     = 10,
    target_rtp_pct   = 82,
    updated_at = now()
where id = 'difficulty-expert';

-- Re-seed Grand Master — 100,000 entry / 220,000 win / 20,000 lose / 80% RTP.
-- Win rate assumed 30% — the steepest house edge of the ladder.
update public.table_configs
set entry_fee_coins  = 100000,
    prize_coins      = 220000,
    prize_coins_loss = 20000,
    pvp_rake_pct     = 10,
    target_rtp_pct   = 80,
    updated_at = now()
where id = 'difficulty-grand-master';
