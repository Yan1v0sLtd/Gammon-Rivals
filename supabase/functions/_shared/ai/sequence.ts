// GENERATED FILE — DO NOT EDIT.
// Deno mirror of apps/game/src/ai for Supabase edge functions
// (server-authored AI turns). apps/game/src/ai is the source of truth;
// regenerate with:  npm run build:shared-ai

import { applyMove, legalMoves } from '../engine/index.ts';
import type { BoardState, Die, Move } from '../engine/index.ts';

export interface MoveSequence {
  readonly finalState: BoardState;
  readonly moves: readonly Move[];
}

/**
 * Enumerate all maximum-length move sequences from (state, dice).
 * Returns one entry per distinct terminal board state — sequences that lead
 * to the same final board are deduplicated (the first ordering found wins).
 */
export function enumerateSequences(
  state: BoardState,
  remaining: readonly Die[]
): MoveSequence[] {
  const all: MoveSequence[] = [];
  walk(state, remaining, [], all);

  // If the only "sequence" found is the no-op leaf (no legal moves at all),
  // treat it as an empty result — caller distinguishes "must pass" cleanly.
  const nonEmpty = all.filter((s) => s.moves.length > 0);
  if (nonEmpty.length === 0) return [];

  const byState = new Map<string, MoveSequence>();
  for (const s of nonEmpty) {
    const key = stateKey(s.finalState);
    if (!byState.has(key)) byState.set(key, s);
  }
  return Array.from(byState.values());
}

function walk(
  state: BoardState,
  remaining: readonly Die[],
  history: Move[],
  out: MoveSequence[]
): void {
  const moves = legalMoves(state, remaining);
  if (moves.length === 0) {
    out.push({ finalState: state, moves: [...history] });
    return;
  }
  const seen = new Set<string>();
  for (const m of moves) {
    const k = `${String(m.from)}->${String(m.to)}@${m.die}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const next = applyMove(state, m);
    const nextRemaining = removeDie(remaining, m.die);
    history.push(m);
    walk(next, nextRemaining, history, out);
    history.pop();
  }
}

function removeDie(dice: readonly Die[], die: Die): readonly Die[] {
  const idx = dice.indexOf(die);
  if (idx < 0) return dice;
  return [...dice.slice(0, idx), ...dice.slice(idx + 1)];
}

function stateKey(s: BoardState): string {
  let k = `${s.turn}|${s.bar.white},${s.bar.black}|${s.off.white},${s.off.black}|`;
  for (const pt of s.points) {
    k += `${pt.owner ?? '_'}${pt.count};`;
  }
  return k;
}
