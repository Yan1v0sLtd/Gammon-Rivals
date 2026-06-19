// GENERATED FILE — DO NOT EDIT.
// Deno mirror of src/ai (move picker) for Supabase edge functions
// (server-authored AI turns). src/ai is the single source of truth;
// regenerate with:  npm run build:shared-ai

import type { BoardState, Player } from '../engine/index.ts';

const opp = (p: Player): Player => (p === 'white' ? 'black' : 'white');

function pip(state: BoardState, p: Player): number {
  let total = 0;
  state.points.forEach((pt, i) => {
    if (pt.owner === p) {
      total += pt.count * (p === 'white' ? 24 - i : i + 1);
    }
  });
  total += state.bar[p] * 25;
  return total;
}

function countBlots(state: BoardState, p: Player): number {
  return state.points.filter((pt) => pt.owner === p && pt.count === 1).length;
}

function countMadePoints(state: BoardState, p: Player): number {
  return state.points.filter((pt) => pt.owner === p && pt.count >= 2).length;
}

function homeboardPoints(state: BoardState, p: Player): number {
  const [lo, hi] = p === 'white' ? [18, 23] : [0, 5];
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const pt = state.points[i];
    if (pt && pt.owner === p && pt.count >= 2) count++;
  }
  return count;
}

/**
 * Position evaluation from `me`'s perspective. Higher = better for `me`.
 *
 * Components (rough weights):
 *  - pip differential (dominant)
 *  - blot count: my blots bad, opponent blots good
 *  - made points: small bonus for owning real estate
 *  - inner-board points: bigger bonus (closer to bearing in / harder to escape from)
 *  - off checkers: huge bonus (game progress)
 */
export function evaluate(state: BoardState, me: Player): number {
  const o = opp(me);
  const pipDiff = pip(state, o) - pip(state, me);
  // Symmetric weights — evaluate(s, white) === -evaluate(s, black)
  return (
    1.0 * pipDiff +
    -3.0 * (countBlots(state, me) - countBlots(state, o)) +
    0.4 * (countMadePoints(state, me) - countMadePoints(state, o)) +
    0.8 * (homeboardPoints(state, me) - homeboardPoints(state, o)) +
    50 * (state.off[me] - state.off[o])
  );
}
