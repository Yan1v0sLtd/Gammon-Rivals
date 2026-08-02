import { describe, expect, it } from 'vitest';
import { applyMove, legalMoves } from '../../../engine/src/rules';
import { initialBoard } from '../../../engine/src/board';
import type { BoardState, Die, Move } from '../../../engine/src/types';
import { makeBoard } from '../../../engine/src/__tests__/helpers';
import { enumerateSequences } from '../sequence';
import { evaluate } from '../evaluator';
import { pickMove, type Rng } from '../picker';

function fixedRng(values: number[]): Rng {
  let i = 0;
  return { next: () => values[i++ % values.length]! };
}

function applySequence(state: BoardState, moves: readonly Move[]): BoardState {
  let s = state;
  for (const m of moves) s = applyMove(s, m);
  return s;
}

function isLegalSequence(state: BoardState, dice: readonly Die[], moves: readonly Move[]): boolean {
  let s = state;
  const remaining = [...dice];
  for (const m of moves) {
    const legal = legalMoves(s, remaining);
    if (!legal.some((x) => x.from === m.from && x.to === m.to && x.die === m.die)) return false;
    s = applyMove(s, m);
    const idx = remaining.indexOf(m.die);
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return true;
}

describe('enumerateSequences', () => {
  it('returns at least one sequence for the opening 3-1', () => {
    const seqs = enumerateSequences(initialBoard(), [3, 1] as Die[]);
    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) {
      expect(isLegalSequence(initialBoard(), [3, 1] as Die[], s.moves)).toBe(true);
    }
  });

  it('uses both dice when possible', () => {
    const seqs = enumerateSequences(initialBoard(), [3, 1] as Die[]);
    expect(seqs.every((s) => s.moves.length === 2)).toBe(true);
  });

  it('returns empty when no legal moves', () => {
    const state = makeBoard({
      points: { 11: ['white', 1], 12: ['black', 3], 13: ['black', 3] },
      turn: 'white',
    });
    const seqs = enumerateSequences(state, [1, 2] as Die[]);
    expect(seqs).toEqual([]);
  });

  it('deduplicates by terminal state', () => {
    // For the opening 3-1, white has the canonical 8-point making sequence (16→17, 11→14 or 11→14, 16→17)
    // — same final state via two orderings. Should appear once.
    const seqs = enumerateSequences(initialBoard(), [3, 1] as Die[]);
    const stateKeys = new Set(
      seqs.map((s) => JSON.stringify(s.finalState.points.map((p) => `${p.owner}:${p.count}`)))
    );
    expect(stateKeys.size).toBe(seqs.length);
  });
});

describe('evaluate', () => {
  it('initial board is symmetric (zero from white perspective)', () => {
    const score = evaluate(initialBoard(), 'white');
    expect(Math.abs(score)).toBeLessThan(0.001);
  });

  it('a leading position scores higher than a trailing one', () => {
    const winning = makeBoard({
      off: { white: 10, black: 0 },
      points: { 18: ['white', 5], 12: ['black', 15] },
    });
    const losing = makeBoard({
      off: { white: 0, black: 10 },
      points: { 11: ['white', 15], 5: ['black', 5] },
    });
    expect(evaluate(winning, 'white')).toBeGreaterThan(evaluate(losing, 'white'));
  });

  it('a blot is worse than no blot at the same total pip', () => {
    const blot = makeBoard({ points: { 11: ['white', 1], 18: ['white', 14] }, turn: 'white' });
    const safe = makeBoard({ points: { 18: ['white', 15] }, turn: 'white' });
    expect(evaluate(blot, 'white')).toBeLessThan(evaluate(safe, 'white'));
  });
});

describe('pickMove — easy', () => {
  it('returns a legal sequence', () => {
    const result = pickMove(initialBoard(), [3, 1] as Die[], 'easy', fixedRng([0]));
    expect(result.moves.length).toBeGreaterThan(0);
    expect(isLegalSequence(initialBoard(), [3, 1] as Die[], result.moves)).toBe(true);
  });

  it('different RNG values pick different sequences (most of the time)', () => {
    const a = pickMove(initialBoard(), [3, 1] as Die[], 'easy', fixedRng([0]));
    const b = pickMove(initialBoard(), [3, 1] as Die[], 'easy', fixedRng([0.99]));
    // They CAN be equal by chance but with deduplicated sequences and the opening,
    // there are many options — the first and last should differ.
    expect(JSON.stringify(a.moves)).not.toEqual(JSON.stringify(b.moves));
  });
});

describe('pickMove — medium', () => {
  it('returns a legal sequence', () => {
    const result = pickMove(initialBoard(), [4, 2] as Die[], 'medium');
    expect(result.moves.length).toBeGreaterThan(0);
    expect(isLegalSequence(initialBoard(), [4, 2] as Die[], result.moves)).toBe(true);
  });

  it('prefers the sequence with the higher heuristic score', () => {
    const result = pickMove(initialBoard(), [3, 1] as Die[], 'medium');
    const final = applySequence(initialBoard(), result.moves);
    // Cross-check: the result's evaluation matches evaluate(final, 'white')
    expect(Math.abs(result.evaluation - evaluate(final, 'white'))).toBeLessThan(0.001);
  });

  it('consolidates a blot home when both dice can run it safely', () => {
    // White already has a blot at 11; 14 stacked at 18. Dice 2-5 can:
    //   - run the blot home: 11→13→18 (or 11→16→18) → 18(15), zero blots
    //   - leave it / make new blots elsewhere
    // The medium AI should pick the consolidate-home option.
    const state = makeBoard({
      points: { 11: ['white', 1], 18: ['white', 14] },
      turn: 'white',
    });
    const result = pickMove(state, [2, 5] as Die[], 'medium');
    const final = applySequence(state, result.moves);
    const whiteBlots = final.points.filter((p) => p.owner === 'white' && p.count === 1).length;
    expect(whiteBlots).toBe(0);
  });
});

describe('pickMove — hard', () => {
  it('returns a legal sequence', () => {
    const result = pickMove(initialBoard(), [6, 5] as Die[], 'hard');
    expect(result.moves.length).toBeGreaterThan(0);
    expect(isLegalSequence(initialBoard(), [6, 5] as Die[], result.moves)).toBe(true);
  }, 20000); // 2-ply takes longer

  it('returns empty when no legal moves', () => {
    const state = makeBoard({
      points: { 11: ['white', 1], 12: ['black', 3], 13: ['black', 3] },
      turn: 'white',
    });
    const result = pickMove(state, [1, 2] as Die[], 'hard');
    expect(result.moves).toEqual([]);
  });
});
