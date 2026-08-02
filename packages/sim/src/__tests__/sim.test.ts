import { describe, expect, it } from 'vitest';
import { initialBoard, pipCount } from '../../../engine/src/board';
import { seededRng } from '../../../engine/src/dice';
import { DIFFICULTY_TIERS, proposedRetune } from '../tiers';
import { aiRtp, pvpRtp, pvpWinnerPrize } from '../economy';
import { leveled, playGame } from '../playGame';

describe('sim harness smoke', () => {
  it('opening pip count is 167 for both sides', () => {
    const b = initialBoard();
    expect(pipCount(b, 'white')).toBe(167);
    expect(pipCount(b, 'black')).toBe(167);
  });

  it('plays full games to a valid result', () => {
    const rng = seededRng(12_345);
    const easy = leveled('easy');
    for (let i = 0; i < 10; i++) {
      const out = playGame(easy, easy, rng);
      expect(['white', 'black']).toContain(out.winner);
      expect(['single', 'gammon', 'backgammon']).toContain(out.winType);
      expect(out.plies).toBeGreaterThan(0);
    }
  });

  it('proposed retune: AI flat prize equals the PvP pot winner amount', () => {
    for (const t of DIFFICULTY_TIERS) {
      const r = proposedRetune(t);
      const pvp = pvpWinnerPrize({ entryFee: t.entryFee, prizeLoss: r.prizeLoss, pvpRakePct: r.rakePct });
      expect(r.prizeWin).toBe(pvp); // the unification invariant
      // at a true 50/50 the tier lands on its configured RTP
      const rtp = aiRtp({ entryFee: t.entryFee, prizeWin: r.prizeWin, prizeLoss: r.prizeLoss }, 0.5) * 100;
      expect(Math.abs(rtp - t.targetRtpPct)).toBeLessThanOrEqual(1.0);
    }
  });

  // Previously only checked when someone manually ran the sim with RUN_SIM=1.
  // It is the core promise of the unified economy, so it belongs in CI.
  it('PvP pot and AI flat payouts agree at a 50/50 matchup', () => {
    for (const t of DIFFICULTY_TIERS) {
      const r = proposedRetune(t);
      const prop = {
        entryFee: t.entryFee,
        prizeWin: r.prizeWin,
        prizeLoss: r.prizeLoss,
        pvpRakePct: r.rakePct,
      };
      expect((pvpRtp(prop, 0.5) * 100).toFixed(1)).toBe((aiRtp(prop, 0.5) * 100).toFixed(1));
    }
  });
});
