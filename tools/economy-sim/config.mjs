// =============================================================================
// Gammon Rivals — Economy / Progression simulation CONFIG
// =============================================================================
// SECTION A is a SNAPSHOT of the LIVE Supabase config (project vekgsukccluwaqdlqpzj,
// pulled 2026-05-31). Treat it as data — re-pull and replace if you change the
// curve, tiers or taps in the Back Office. Nothing here is invented.
//
// SECTION B is the BEHAVIORAL MODEL (assumptions). These are the only knobs that
// are *not* straight from your DB — they are clearly labelled and tunable. The
// sim's job is to be sensitive to these, so tweak + re-run.
// =============================================================================

// ----------------------------------------------------------------------------
// SECTION A — LIVE CONFIG SNAPSHOT
// ----------------------------------------------------------------------------

// Currency → USD (micros). 1 coin = $0.0001, 1 gem = $0.01. Used only to label
// numbers in USD; the user asked for IN-COIN analysis so this is informational.
export const CURRENCY = { coinUsd: 0.0001, gemUsd: 0.01 };

// --- Level curve (level_configs). xpRequired is CUMULATIVE. ------------------
// Levels 1..80 are inlined verbatim from the DB. From L80 up, the live curve is
// exactly linear: xpRequired(L) = 128096 + (L-80)*3518, reward_coins = 3250,
// and a gem drop every 10th level (verified against all 500 rows). We generate
// 81..500 from that rule so the snapshot stays compact but identical.
const XP_REQ_1_80 = [
  0, 70, 154, 255, 376, 521, 695, 904, 1155, 1456,
  1775, 2113, 2471, 2850, 3252, 3678, 4130, 4609, 5117, 5655,
  6225, 6829, 7469, 8147, 8866, 9628, 10436, 11292, 12199, 13160,
  14179, 15259, 16404, 17618, 18905, 20269, 21715, 23248, 24873, 26596,
  28350, 30136, 31954, 33805, 35689, 37607, 39560, 41548, 43572, 45632,
  47729, 49864, 52037, 54249, 56501, 58794, 61128, 63504, 65923, 68386,
  70893, 73445, 76043, 78688, 81381, 84122, 86912, 89752, 92643, 95586,
  98582, 101632, 104737, 107898, 111116, 114392, 117727, 121122, 124578, 128096,
];
const REWARD_COINS_1_80 = [
  0, 100, 100, 150, 150, 200, 250, 300, 350, 400,
  450, 450, 500, 500, 550, 600, 600, 650, 700, 750,
  800, 850, 900, 950, 1000, 1050, 1100, 1200, 1250, 1350,
  1350, 1350, 1350, 1400, 1500, 1550, 1650, 1750, 1850, 2000,
  2000, 2050, 2100, 2150, 2150, 2200, 2250, 2300, 2350, 2350,
  2400, 2450, 2500, 2550, 2600, 2650, 2700, 2750, 2800, 2850,
  2850, 2850, 2850, 2850, 2850, 2850, 2850, 2850, 2850, 2850,
  2850, 2850, 2850, 2900, 2950, 3000, 3050, 3150, 3200, 3250,
];
function gemFor(level) {
  if (level % 10 !== 0) return 0;
  if (level <= 20) return 5;
  if (level <= 50) return 7;
  if (level <= 100) return 10;
  if (level <= 200) return 12;
  if (level <= 300) return 15;
  return 20;
}
// Applied 2026-06-02 (mirrors live level_configs after the FTUE retune):
//  • L1–10 = hardcoded fast FTUE ramp (~630 XP total; L3=150 ≈ 3 Beginner matches).
//  • L11–500 = the original curve shifted −826 (continues smoothly off L10=630),
//    with reward_coins = max(50, 3% of each level's XP gap) and gems unchanged.
const FTUE_XP    = [0, 50, 150, 240, 330, 410, 480, 540, 590, 630]; // L1..10
const FTUE_COINS = [0, 50,  75,  75, 100, 100, 125, 125, 150, 200]; // L1..10
const REBASE_SHIFT = 826; // old L10 (1456) − new L10 (630)
const oldXpReq = (L) => (L <= 80 ? XP_REQ_1_80[L - 1] : 128096 + (L - 80) * 3518);
export const CURVE = (() => {
  const rows = [];
  for (let L = 1; L <= 500; L++) {
    if (L <= 10) {
      rows.push({ level: L, xpRequired: FTUE_XP[L - 1], rewardCoins: FTUE_COINS[L - 1], rewardGems: L === 10 ? 5 : 0 });
    } else {
      const inc = oldXpReq(L) - oldXpReq(L - 1);
      rows.push({ level: L, xpRequired: oldXpReq(L) - REBASE_SHIFT, rewardCoins: Math.max(50, Math.round(0.03 * inc)), rewardGems: gemFor(L) });
    }
  }
  return rows;
})();
export const MAX_LEVEL = CURVE.length;

// --- Difficulty + standard rooms (table_configs). ----------------------------
// finish_match: XP (win only) = base_xp_win * xp_multiplier_pct/100 * boost.
// Coins: win => prizeWin (AI) ; loss => prizeLoss ; first 10 AI tiered matches
// are risk-free (entry refunded if entry > prizeLoss). Entry fee is the SINK,
// deducted at enter_room (we apply it in the engine on entry).
export const TIERS = [
  // id, label, entry, prizeWin, prizeLoss, baseXp, xpMultPct, reqLevel, targetRtp, matchTarget, aiLevel
  { id: 'practice-ai',  label: 'Practice AI',  entry: 0,      prizeWin: 50,     prizeLoss: 0,     baseXp: 0,  xpMultPct: 100, reqLevel: 1,  targetRtp: 90, matchTarget: 7,  ai: 'medium', kind: 'standard' },
  { id: 'online-casual',label: 'Play Online',  entry: 100,    prizeWin: 180,    prizeLoss: 0,     baseXp: 0,  xpMultPct: 100, reqLevel: 3,  targetRtp: 90, matchTarget: 7,  ai: 'medium', kind: 'standard' },
  { id: 'beginner',     label: 'Beginner',     entry: 1000,   prizeWin: 1200,   prizeLoss: 100,   baseXp: 50, xpMultPct: 0,   reqLevel: 1,  targetRtp: 90, matchTarget: 5,  ai: 'easy',   kind: 'difficulty' },
  { id: 'advanced',     label: 'Advanced',     entry: 3000,   prizeWin: 4200,   prizeLoss: 300,   baseXp: 50, xpMultPct: 50,  reqLevel: 3,  targetRtp: 87, matchTarget: 7,  ai: 'easy',   kind: 'difficulty' },
  { id: 'pro',          label: 'Pro',          entry: 10000,  prizeWin: 15000,  prizeLoss: 1500,  baseXp: 50, xpMultPct: 150, reqLevel: 5,  targetRtp: 85, matchTarget: 7,  ai: 'medium', kind: 'difficulty' },
  { id: 'expert',       label: 'Expert',       entry: 30000,  prizeWin: 54000,  prizeLoss: 4500,  baseXp: 50, xpMultPct: 250, reqLevel: 10, targetRtp: 82, matchTarget: 9,  ai: 'medium', kind: 'difficulty' },
  { id: 'grand-master', label: 'Grand Master', entry: 100000, prizeWin: 220000, prizeLoss: 20000, baseXp: 50, xpMultPct: 500, reqLevel: 20, targetRtp: 80, matchTarget: 11, ai: 'hard',   kind: 'difficulty' },
];
export const RISK_FREE_FIRST_N = 10; // AI tiered matches with entry refunded on loss

// XP per match. Per design (SELECT ROOM screen): XP = base × (1 + boost%), i.e.
// the boost is ADDED on top of the base 50 — Beginner (0% boost) = 50, not 0.
//   Beginner 50 · Advanced 75 · Pro 125 · Expert 175 · Grand Master 300.
// (The live finish_match has this as base × boost/100, which zeroes Beginner —
// a bug; see DRAFT_finish_match_xp.sql for the fix.)
export function xpPerWin(tier) {
  return Math.floor((tier.baseXp * (100 + tier.xpMultPct)) / 100);
}

// --- Taps -------------------------------------------------------------------
export const SIGNUP_GRANT = { coins: 10000, gems: 100 }; // economy_grants 'signup'

// daily_bonus_configs (day 1..7). Streak advances on consecutive claim, resets if a day is missed.
export const DAILY_BONUS = [
  { day: 1, coins: 200, gems: 0,  xp: 0 },
  { day: 2, coins: 150, gems: 10, xp: 0 },
  { day: 3, coins: 250, gems: 0,  xp: 10 },
  { day: 4, coins: 300, gems: 0,  xp: 0 },
  { day: 5, coins: 0,   gems: 50, xp: 20 },
  { day: 6, coins: 350, gems: 0,  xp: 0 },
  { day: 7, coins: 500, gems: 75, xp: 20 },
];

// wheel_slots (config 'main', hourly cooldown). chanceBp = chance in basis points (/10000).
export const WHEEL_SLOTS = [
  { coins: 100,  gems: 0,  xp: 0,  chanceBp: 2500 },
  { coins: 0,    gems: 5,  xp: 0,  chanceBp: 1500 },
  { coins: 200,  gems: 0,  xp: 5,  chanceBp: 1800 },
  { coins: 0,    gems: 0,  xp: 10, chanceBp: 1200 },
  { coins: 500,  gems: 0,  xp: 0,  chanceBp: 1000 },
  { coins: 50,   gems: 10, xp: 0,  chanceBp: 800 },
  { coins: 1000, gems: 0,  xp: 0,  chanceBp: 500 },
  { coins: 0,    gems: 0,  xp: 25, chanceBp: 400 },
  { coins: 0,    gems: 25, xp: 0,  chanceBp: 250 },
  { coins: 5000, gems: 10, xp: 0,  chanceBp: 50 },  // jackpot
];

// Coin-priced boards (board_theme_configs). Optional one-time coin SINK, level-gated.
export const COIN_BOARDS = [
  { id: 'caribbean', priceCoins: 2500, unlockLevel: 3 },
  { id: 'zen-garden', priceCoins: 3000, unlockLevel: 5 },
];

// ----------------------------------------------------------------------------
// SECTION B — BEHAVIORAL MODEL (ASSUMPTIONS — tune these)
// ----------------------------------------------------------------------------
// NOTE: these are NOT from the DB. They are the modeller's assumptions about how
// players behave. Every result is conditional on them — change + re-run.

export const HORIZON_DAYS = 180; // simulate ~6 months
export const SEED = 12345;       // deterministic; change for a different draw

// --- Iteration switches (operator direction 2026-05-31) ---------------------
// Analyse the CORE LOOP + LEVEL tap ONLY. The wheel / daily bonus / missions are
// "meta" taps the operator will tune separately, so they're excluded here.
export const INCLUDE_FREE_TAPS = false; // wheel + daily bonus
export const INCLUDE_MISSIONS = false;  // missions/chests
export const SIGNUP_AS_SEED_ONLY = true; // 10k signup = starting bankroll, not an ongoing tap

// PROPOSED core-mechanic change: every match grants XP (win AND loss) — a paid
// entry should always advance the player. (Live finish_match only awards on win.)
export const XP_ON_LOSS = true;

// Model a lower core RTP to leave room for meta taps to hand out coins.
// null => use each tier's live target_rtp_pct (80–90). A number => apply to all.
export const CORE_RTP_OVERRIDE = 0.80; // 80% average

// Design rule: the level-up coin bonus should add only 0.1–0.3 percentage points
// on top of the core RTP (i.e. level coins ÷ coins wagered ≈ 0.1–0.3%).
export const LEVEL_BONUS_TARGET_PP = [0.1, 0.3];

// Beginner is xp_multiplier_pct=0 (0 XP) in live config. Only used by the legacy
// 'per_match_flat' XP mode below.
export const BEGINNER_XP_PER_MATCH = 25;

// XP MODE (operator-selected 2026-05-31): 'per_wager' => XP per match = entry ×
// XP_PER_COIN_WAGERED. This makes the level-bonus pp UNIFORM across tiers (it no
// longer depends on which tier you grind) and removes the Beginner XP-efficiency
// exploit. 'per_match_flat' keeps the live per-tier values.
export const XP_MODE = 'per_wager';
// PACE dial. pp ≈ rewardPerLevel × XP_PER_COIN_WAGERED / xpPerLevel, so pace and
// the level-bonus pp are coupled: higher = faster leveling AND higher pp.
// 0.002 (1 XP per 500 coins staked) lands the bonus at ~0.2–0.3pp on the current
// reward curve. Raise for faster leveling (then trim level rewards to stay in band).
export const XP_PER_COIN_WAGERED = 0.002;

// Missions-sizing sweep: model the missions tap as refilling this FRACTION of the
// coins a player wagers each active day ("missions refill ~X% of wagered"). 0 =
// baseline (no missions). Missions grant COINS only — XP still comes purely from
// matches (wager-proportional), so the level-bonus pp rule is unaffected.
export const MISSIONS_REFILL_PCTS = [0, 0.10, 0.15, 0.20, 0.25, 0.30];

// Average-skill win probability per tier. Anchored so that an AVERAGE-skill
// player realises the tier's TARGET RTP given its prizes:
//   p* = (RTP*entry - prizeLoss) / (prizeWin - prizeLoss).
// Skill deltas (below) shift this; a strongly-skilled player can exceed it
// (RTP > 100% => net coin printer), which is exactly what we want to test.
// Standard rooms get a neutral 0.5 baseline (no RTP anchor / 0 XP anyway).
export const BASE_WINRATE_OVERRIDE = {
  'practice-ai': 0.6,
  'online-casual': 0.5, // PvP-ish; symmetric
};

// MISSIONS + CHESTS — the one real DATA GAP. Missions pay mission_points that
// convert to coins/gems/XP via weekly-pass chests, whose reward tables we did
// NOT snapshot. We approximate the chest output as a flat per-active-day grant
// per archetype. Set to 0 to see the strict matches+daily+wheel lower bound.
// >>> Replace with real chest_rewards data when available. <<<
export const MISSIONS_CHESTS_PER_ACTIVE_DAY = {
  // coins, xp, gems granted on an active day from missions/chests (approx)
  f2p:      { coins: 300, xp: 8,  gems: 3 },
  casual:   { coins: 150, xp: 4,  gems: 1 },
  hardcore: { coins: 500, xp: 14, gems: 5 },
  whale:    { coins: 600, xp: 16, gems: 6 },
};

// Player archetypes. Population must sum to 1.0.
//  weight        : share of population
//  activeProb    : P(logs in on a given day)
//  spinsPerActive : hourly-wheel spins claimed on an active day
//  matchesPerActive: [min,max] tiered/standard matches played on an active day
//  skillDelta    : added to base win-rate (clamped 0.05..0.95). + = stronger.
//  progressionAware: if true, AVOIDS 0-XP tiers (Beginner/standard) once a
//                    higher XP tier is affordable+unlocked — i.e. plays to level.
//                    if false, just plays the cheapest difficulty tier (Beginner)
//                    for fun and unknowingly earns 0 XP from matches.
//  riskBufferX   : will only enter a tier if balance >= entry * riskBufferX
//                  (keeps a cushion against loss streaks).
//  buysBoards    : spends coins on level-gated coin boards when affordable.
export const ARCHETYPES = [
  { key: 'f2p',      name: 'F2P Grinder', weight: 0.40, activeProb: 0.85, spinsPerActive: 5,  matchesPerActive: [4, 10], skillDelta:  0.00, progressionAware: true,  riskBufferX: 3, buysBoards: true },
  { key: 'casual',   name: 'Casual',      weight: 0.35, activeProb: 0.45, spinsPerActive: 2,  matchesPerActive: [1, 4],  skillDelta: -0.05, progressionAware: false, riskBufferX: 2, buysBoards: false },
  { key: 'hardcore', name: 'Hardcore',    weight: 0.20, activeProb: 0.95, spinsPerActive: 10, matchesPerActive: [8, 20], skillDelta:  0.05, progressionAware: true,  riskBufferX: 4, buysBoards: true },
  { key: 'whale',    name: 'Whale-style', weight: 0.05, activeProb: 0.98, spinsPerActive: 12, matchesPerActive: [12, 30],skillDelta:  0.08, progressionAware: true,  riskBufferX: 5, buysBoards: true },
];

// Per-player skill noise (std-dev added to skillDelta, normal) so a segment
// isn't monolithic — produces the win-rate spread that drives the churn tail.
export const SKILL_NOISE_SD = 0.05;

// Churn: a player who is "stalled" (can't afford any XP-bearing tier AND isn't
// progressing) for this many consecutive active days is considered churned and
// stops playing. (In-coin only — there is no real-money top-up path modelled.)
export const CHURN_STALL_DAYS = 14;

export const ARCHETYPE_BY_KEY = Object.fromEntries(ARCHETYPES.map((a) => [a.key, a]));
