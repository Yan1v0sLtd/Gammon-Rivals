import { enumerateSequences } from './sequence';
import { evaluate } from './evaluator';
import type { BoardState, Die, Move } from '@engine';

export interface Rng {
  next(): number;
}

const mathRng: Rng = { next: () => Math.random() };

/**
 * Softmax (Boltzmann) move policy for smooth, tunable strength.
 *
 * Scores every legal move sequence with the position evaluator, then samples
 * one with probability proportional to exp(score / temperature):
 *   - temperature -> 0    : always the best move (strongest; == the 'medium' picker)
 *   - higher temperature  : increasingly likely to choose weaker moves
 *   - temperature -> large : approaches uniform random (weakest; == the 'easy' picker)
 *
 * Unlike a per-move "blunder probability" (random-or-best coin flip, which
 * collapses win rate far too fast to be matchable), strength degrades smoothly
 * here — so the sim can calibrate temperature to a target win rate and the AI
 * can be rating-matched to a player. (Task #146 — tunable AI strength.)
 *
 * Pure: no React/Pixi/Supabase. Mirrors picker.ts's contract — returns the
 * chosen sequence's moves, or [] when there is no legal play.
 */
export function pickMoveSoftmax(
  state: BoardState,
  remaining: readonly Die[],
  temperature: number,
  rng: Rng = mathRng
): readonly Move[] {
  const sequences = enumerateSequences(state, remaining);
  if (sequences.length === 0) return [];
  if (sequences.length === 1) return [...sequences[0]!.moves];

  const me = state.turn;
  const scores = sequences.map((seq) => evaluate(seq.finalState, me));

  // temperature <= ~0: deterministic best move (argmax).
  if (!(temperature > 1e-9)) {
    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i]! > scores[bestIdx]!) bestIdx = i;
    }
    return [...sequences[bestIdx]!.moves];
  }

  // Softmax with max-subtraction for numerical stability.
  const maxScore = Math.max(...scores);
  let total = 0;
  const weights = scores.map((s) => {
    const w = Math.exp((s - maxScore) / temperature);
    total += w;
    return w;
  });

  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return [...sequences[i]!.moves];
  }
  return [...sequences[sequences.length - 1]!.moves];
}
