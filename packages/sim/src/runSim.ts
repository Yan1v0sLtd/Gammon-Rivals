/**
 * Monte-Carlo economy + AI-ladder simulator runner.
 *
 * Standalone dev tooling (run via `npm run sim`, see scripts/run-economy-sim.mjs):
 *  - sanity-checks the sim harness itself (engine pip counts, playGame validity,
 *    the proposed-retune unification invariant),
 *  - prints the economy RTP report, the AI strength ladder, and the
 *    rating-match softmax temperature sweep.
 *
 *   npm run sim                        → full report, 1000 games per pairing
 *   SIM_GAMES=4000 npm run sim         → more games
 *
 * No vitest here: the sanity checks are plain runtime guards (assert()), kept
 * cheap and always-on because they are self-checks of the sim itself, not unit
 * tests.
 */
import { initialBoard, pipCount } from '../../engine/src/board';
import { seededRng } from '../../engine/src/dice';
import { DIFFICULTY_TIERS, proposedRetune } from './tiers';
import { aiHouseCoinsPerMatch, aiRtp, pvpRtp, pvpWinnerPrize } from './economy';
import { leveled, playGame, runFair, softmaxPicker, type Picker } from './playGame';

// Read env without a hard dependency on Node's `process` global typing (the
// app build's tsconfig has no node types). Falls back to {} under any runtime.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const DEFAULT_GAMES = 1_000;
/**
 * Games per pairing. Must be a positive integer — `runFair` divides by it, so a
 * NaN/zero/negative value would silently print a report full of `NaN%`.
 */
const GAMES = ((raw: string | undefined): number => {
  if (raw === undefined || raw === '') return DEFAULT_GAMES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`SIM_GAMES must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
})(env.SIM_GAMES);

/** Runtime guard for the sim's self-checks (assertions, not unit tests). */
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`sim sanity check failed: ${msg}`);
}

/** Sim-harness sanity checks. Cheap and always-on. */
function sanityChecks(): void {
  const b = initialBoard();
  assert(pipCount(b, 'white') === 167, 'opening pip count is 167 for white');
  assert(pipCount(b, 'black') === 167, 'opening pip count is 167 for black');

  const rng = seededRng(12_345);
  const easy = leveled('easy');
  for (let i = 0; i < 10; i++) {
    const out = playGame(easy, easy, rng);
    assert(['white', 'black'].includes(out.winner), `valid winner, got ${out.winner}`);
    assert(
      ['single', 'gammon', 'backgammon'].includes(out.winType),
      `valid winType, got ${out.winType}`
    );
    assert(out.plies > 0, 'plies is positive');
  }

  for (const t of DIFFICULTY_TIERS) {
    const r = proposedRetune(t);
    const pvp = pvpWinnerPrize({ entryFee: t.entryFee, prizeLoss: r.prizeLoss, pvpRakePct: r.rakePct });
    assert(r.prizeWin === pvp, 'AI flat prize equals the PvP pot winner amount');
    // at a true 50/50 the tier lands on its configured RTP
    const rtp = aiRtp({ entryFee: t.entryFee, prizeWin: r.prizeWin, prizeLoss: r.prizeLoss }, 0.5) * 100;
    assert(
      Math.abs(rtp - t.targetRtpPct) <= 1.0,
      `RTP ${rtp} within 1.0 of target ${t.targetRtpPct}`
    );
  }
  console.log('sanity checks passed');
}

/** Economy RTP report: current vs proposed payout across a win-rate stress range. */
function economyRtpReport(): void {
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
    assert(
      (pvpRtp(prop, 0.5) * 100).toFixed(1) === (aiRtp(prop, 0.5) * 100).toFixed(1),
      'PvP pot and AI flat RTP agree at p=0.5'
    );
  }
  console.log(out.join('\n'));
}

/** AI strength ladder: head-to-head win rates (color-balanced). */
function aiStrengthLadder(): void {
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
}

/** Rating-match calibration: sweep softmax temperature vs reference players. */
function ratingMatchCalibration(): void {
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
}

export async function main(): Promise<void> {
  sanityChecks();
  economyRtpReport();
  aiStrengthLadder();
  ratingMatchCalibration();
}
