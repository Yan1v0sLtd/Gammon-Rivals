// GENERATED FILE — DO NOT EDIT.
// Deno mirror of apps/game/src/ai for Supabase edge functions
// (server-authored AI turns). apps/game/src/ai is the source of truth;
// regenerate with:  npm run build:shared-ai

import type { BoardState, Die, Move, Player } from '../engine/index.ts';
import { enumerateSequences, type MoveSequence } from './sequence.ts';
import { evaluate } from './evaluator.ts';
import type { AILevel } from './types.ts';

export interface Rng {
  next(): number;
}

const mathRng: Rng = { next: () => Math.random() };

export interface PickResult {
  readonly moves: readonly Move[];
  readonly evaluation: number;
}

const HARD_TOP_K = 6;

/**
 * Choose a turn's worth of moves for the player whose turn it is in `state`.
 * Returns a fully resolved sequence of moves; an empty array means no legal play.
 */
export function pickMove(
  state: BoardState,
  remaining: readonly Die[],
  level: AILevel,
  rng: Rng = mathRng
): PickResult {
  const sequences = enumerateSequences(state, remaining);
  if (sequences.length === 0) {
    return { moves: [], evaluation: 0 };
  }

  if (level === 'easy') {
    const idx = Math.floor(rng.next() * sequences.length);
    return { moves: [...sequences[idx]!.moves], evaluation: 0 };
  }

  const me = state.turn;
  const scored = sequences.map((seq) => ({
    seq,
    score: evaluate(seq.finalState, me),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (level === 'medium') {
    return { moves: [...scored[0]!.seq.moves], evaluation: scored[0]!.score };
  }

  // Hard: rerank top-K by 2-ply lookahead
  const topK = scored.slice(0, Math.min(HARD_TOP_K, scored.length));
  for (const c of topK) {
    c.score = twoPlyScore(c.seq, me);
  }
  topK.sort((a, b) => b.score - a.score);
  return { moves: [...topK[0]!.seq.moves], evaluation: topK[0]!.score };
}

/**
 * Expected position value after our move sequence, assuming opponent plays
 * the move that minimizes our heuristic across all possible dice rolls.
 */
function twoPlyScore(seq: MoveSequence, me: Player): number {
  const oppPlayer: Player = me === 'white' ? 'black' : 'white';
  const oppState: BoardState = { ...seq.finalState, turn: oppPlayer };

  let weightedSum = 0;
  let totalWeight = 0;

  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      const weight = a === b ? 1 : 2; // out of 36
      const dice: Die[] =
        a === b ? [a as Die, a as Die, a as Die, a as Die] : [a as Die, b as Die];
      const oppSeqs = enumerateSequences(oppState, dice);
      let worst: number;
      if (oppSeqs.length === 0) {
        worst = evaluate(oppState, me);
      } else {
        worst = Infinity;
        for (const s of oppSeqs) {
          const sc = evaluate(s.finalState, me);
          if (sc < worst) worst = sc;
        }
      }
      weightedSum += worst * weight;
      totalWeight += weight;
    }
  }

  return weightedSum / totalWeight;
}
