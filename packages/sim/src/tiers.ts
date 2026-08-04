/**
 * Snapshot of the live difficulty-tier economy config
 * (public.table_configs WHERE kind = 'difficulty') as of 2026-06-18, after the
 * single-game unification (migration 20260618120000). proposedRetune() now
 * reproduces these live values from target_rtp_pct — kept as the documented
 * derivation for future retunes.
 *
 * Kept as pure data so the economy sim runs headless with no Supabase
 * dependency (engine-purity rule). Refresh by re-querying table_configs when
 * the live config changes. (Task #133 — snapshot live economy config into sim.)
 */
export type TierConfig = {
  readonly id: string,
  readonly displayName: string,
  readonly entryFee: number,
  readonly prizeWin: number,
  readonly prizeLoss: number,
  readonly pvpRakePct: number,
  readonly targetRtpPct: number,
  readonly matchTarget: number,
}

export const DIFFICULTY_TIERS: readonly TierConfig[] = [
  {id: "difficulty-beginner", displayName: "Beginner", entryFee: 1_000, prizeWin: 1_700, prizeLoss: 100, pvpRakePct: 10, targetRtpPct: 90, matchTarget: 1},
  {id: "difficulty-advanced", displayName: "Advanced", entryFee: 3_000, prizeWin: 4_920, prizeLoss: 300, pvpRakePct: 13, targetRtpPct: 87, matchTarget: 1},
  {id: "difficulty-pro", displayName: "Pro", entryFee: 10_000, prizeWin: 15_500, prizeLoss: 1_500, pvpRakePct: 15, targetRtpPct: 85, matchTarget: 1},
  {id: "difficulty-expert", displayName: "Expert", entryFee: 30_000, prizeWin: 44_700, prizeLoss: 4_500, pvpRakePct: 18, targetRtpPct: 82, matchTarget: 1},
  {id: "difficulty-grand-master", displayName: "Grand Master", entryFee: 100_000, prizeWin: 140_000, prizeLoss: 20_000, pvpRakePct: 20, targetRtpPct: 80, matchTarget: 1},
]

export type RetunedTier = {
  readonly rakePct: number,
  readonly prizeWin: number,
  readonly prizeLoss: number,
  readonly matchTarget: number,
}

/**
 * Proposed unified single-game retune: ONE player-facing payout per tier,
 * identical whether the opponent is a human (PvP) or a rating-matched AI.
 *
 * Derived so the PvP pot model lands exactly on the tier's target RTP:
 *   rake   = 100 - targetRtp
 *   winner = pot*(1 - rake) - loserConsolation
 * The AI flat prize is then set to the SAME winner amount, so the two paths
 * pay identically. Assumes a ~50/50 opponent (rating-matched AI or matched
 * human). (Tasks #148/#149.)
 */
export function proposedRetune(t: TierConfig): RetunedTier {
  const rakePct = 100 - t.targetRtpPct
  const pot = 2 * t.entryFee
  const prizeWin = Math.max(0, Math.round((pot * (100 - rakePct)) / 100) - t.prizeLoss)
  return {rakePct, prizeWin, prizeLoss: t.prizeLoss, matchTarget: 1}
}
