/**
 * Pure economy model for the unified single-game tiers. No engine or Supabase
 * imports — just the payout math, so it can be unit-tested and stress-swept
 * over a range of win probabilities. (Task #147 — economy RTP report.)
 *
 * Two payout paths, designed to produce the SAME player-facing numbers:
 *  - AI match:  house funds a flat prize. EV = p·win + (1-p)·loss.
 *  - PvP match: pot = 2·fee; winner takes pot - rake - loserConsolation.
 *
 * RTP is the player's expected return as a fraction of the entry fee. The house
 * margin is (1 - RTP): in PvP it's the rake; in an AI match it's the gap the
 * house keeps over many matches (the house funds the prize but nets the margin).
 */

export interface AiPayout {
  readonly entryFee: number;
  readonly prizeWin: number;
  readonly prizeLoss: number;
}

export interface PvpPayout {
  readonly entryFee: number;
  readonly prizeLoss: number;
  readonly pvpRakePct: number;
}

/** AI match: player expected return as a fraction of the entry fee. */
export function aiRtp(t: AiPayout, pWin: number): number {
  if (t.entryFee <= 0) return Number.NaN;
  return (pWin * t.prizeWin + (1 - pWin) * t.prizeLoss) / t.entryFee;
}

/** PvP winner payout from the pot: pot - rake - loser consolation. */
export function pvpWinnerPrize(t: PvpPayout): number {
  const pot = 2 * t.entryFee;
  const rake = Math.round((pot * t.pvpRakePct) / 100);
  return Math.max(0, pot - rake - t.prizeLoss);
}

/** PvP match: player expected return as a fraction of the entry fee at win prob pWin. */
export function pvpRtp(t: PvpPayout, pWin: number): number {
  if (t.entryFee <= 0) return Number.NaN;
  return (pWin * pvpWinnerPrize(t) + (1 - pWin) * t.prizeLoss) / t.entryFee;
}

/**
 * House coins per AI match (positive = house profit). The house collects the
 * entry fee and funds the prize, so this is fee - player's expected payout.
 * Over many matches this should stay >= 0 for the economy not to bleed.
 */
export function aiHouseCoinsPerMatch(t: AiPayout, pWin: number): number {
  return t.entryFee - (pWin * t.prizeWin + (1 - pWin) * t.prizeLoss);
}
