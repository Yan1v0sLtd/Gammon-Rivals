// @vitest-environment node
/**
 * Sim runner. Doubles as a fast harness smoke test on every `npm test`, and a
 * full Monte-Carlo economy + AI-ladder report under RUN_SIM=1.
 *
 *   npm test                                   → smoke only (fast, CI-safe)
 *   RUN_SIM=1 npx vitest run src/sim/economy.sim.test.ts   → full report
 *   RUN_SIM=1 SIM_GAMES=4000 npx vitest run ...            → more games
 */
import { describe, expect, it } from 'vitest';
import { initialBoard, pipCount } from '../../../../packages/engine/src/board';
import { seededRng } from '../../../../packages/engine/src/dice';
import { DIFFICULTY_TIERS, proposedRetune } from './tiers';
import { aiHouseCoinsPerMatch, aiRtp, pvpRtp, pvpWinnerPrize } from './economy';
import { leveled, playGame, runFair, softmaxPicker, type Picker } from './playGame';

// Read env without a hard dependency on Node's `process` global typing (the
// app build's tsconfig has no node types). Falls back to {} under any runtime.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const FULL = !!env.RUN_SIM;
const GAMES = Number(env.SIM_GAMES ?? (FULL ? 1_000 : 0));

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
});

describe.runIf(FULL)('economy RTP report', () => {
  it('prints current vs proposed RTP across a win-rate stress range', () => {
    const ps = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
    const out: string[] = ['\n=== UNIFIED SINGLE-GAME ECONOMY — RTP by player win probability ==='];
    for (const t of DIFFICULTY_TIERS) {
      const r = proposedRetune(t);
      const prop = { entryFee: t.entryFee, prizeWin: r.prizeWin, prizeLoss: r.prizeLoss, pvpRakePct: r.rakePct };
      out.push(`\n${t.displayName}  fee ${t.entryFee.toLocaleString()}  (target RTP ${t.targetRtpPct}%)`);
      out.push(`  current : win ${t.prizeWin.toLocaleString()} / loss ${t.prizeLoss.toLocaleString()}, match_target ${t.matchTarget} (multi-game)`);
      out.push(`  proposed: win ${r.prizeWin.toLocaleString()} / loss ${r.prizeLoss.toLocaleString()}, rake ${r.rakePct}%, single game`);
      out.push('    pWin    curAI-RTP   propRTP   housePerMatch');
      for (const p of ps) {
        const cur = (aiRtp(t, p) * 100).toFixed(1).padStart(7);
        const pr = (aiRtp(prop, p) * 100).toFixed(1).padStart(7);
        const house = Math.round(aiHouseCoinsPerMatch(prop, p)).toLocaleString().padStart(10);
        const star = Math.abs(p - 0.5) < 1e-9 ? '  <- matched' : '';
        out.push(`    ${p.toFixed(2)}    ${cur}%    ${pr}%    ${house}${star}`);
      }
      // AI flat and PvP pot agree at every p under the proposal
      expect((pvpRtp(prop, 0.5) * 100).toFixed(1)).toBe((aiRtp(prop, 0.5) * 100).toFixed(1));
    }
    console.log(out.join('\n'));
  });
});

describe.runIf(FULL && GAMES > 0)('AI strength ladder', () => {
  it(
    'measures head-to-head win rates (color-balanced)',
    () => {
      const rng = seededRng(98_765);
      const easy = leveled('easy');
      const medium = leveled('medium');
      const pairs: Array<[string, Picker, Picker]> = [
        ['medium vs medium (self — expect ~50%)', medium, medium],
        ['medium vs easy', medium, easy],
        ['easy vs easy (self — expect ~50%)', easy, easy],
      ];
      const out: string[] = [`\n=== AI STRENGTH LADDER (n=${GAMES} per pairing) ===`];
      for (const [label, a, b] of pairs) {
        const r = runFair(a, b, GAMES, rng);
        out.push(
          `${label}\n   A win ${(r.aWinRate * 100).toFixed(1)}%  |  gammon ${(r.winTypeShare.gammon * 100).toFixed(1)}%  backgammon ${(r.winTypeShare.backgammon * 100).toFixed(1)}%  |  avg plies ${r.avgPlies.toFixed(1)}`
        );
      }
      console.log(out.join('\n'));
    },
    600_000
  );
});

describe.runIf(FULL && GAMES > 0)('rating-match calibration', () => {
  it(
    'sweeps softmax temperature vs easy and medium reference players',
    () => {
      const rng = seededRng(2_024);
      const easyRef = leveled('easy');
      const medRef = leveled('medium');
      const n = Math.min(GAMES, 300);
      const temps = [0, 2, 4, 8, 16, 32, 64, 128];
      const out: string[] = [
        `\n=== RATING-MATCH CALIBRATION — softmax temperature (n=${n}) ===`,
        '  T=0 strongest (best move) … large T weakest (random)',
        '     T     AI win% vs easy    AI win% vs medium',
      ];
      for (const T of temps) {
        const ai = softmaxPicker(T);
        const vsEasy = runFair(ai, easyRef, n, rng).aWinRate * 100;
        const vsMed = runFair(ai, medRef, n, rng).aWinRate * 100;
        out.push(
          `   ${String(T).padStart(4)}        ${vsEasy.toFixed(1).padStart(5)}%             ${vsMed.toFixed(1).padStart(5)}%`
        );
      }
      console.log(out.join('\n'));
    },
    600_000
  );
});
