import { describe, expect, it } from 'vitest';
import {
  applyMove,
  endTurn,
  expandDice,
  initialBoard,
  legalMoves,
  roll,
  seededRng,
  winner,
} from '../../engine';
import type { BoardState, Die } from '../../engine';
import { pickMove } from '../picker';

/** Drive a hot-seat-style turn for whoever's turn it is, using the AI picker. */
function playTurn(state: BoardState, dice: readonly Die[], level: 'easy' | 'medium' | 'hard') {
  const result = pickMove(state, dice, level);
  let s = state;
  let r = [...dice];
  for (const move of result.moves) {
    // Sanity: every move must be legal at its respective state
    const legal = legalMoves(s, r);
    const ok = legal.some((m) => m.from === move.from && m.to === move.to && m.die === move.die);
    if (!ok) {
      throw new Error(
        `AI returned illegal move ${JSON.stringify(move)} at state turn ${s.turn} dice ${r.join(',')}`
      );
    }
    s = applyMove(s, move);
    const idx = r.indexOf(move.die);
    if (idx >= 0) r.splice(idx, 1);
  }
  return endTurn(s);
}

describe('AI integration — playing a full game', () => {
  it('two AIs at medium level can play a complete game without illegal moves', () => {
    const rng = seededRng(12345);
    let state = initialBoard();
    let turns = 0;
    const MAX_TURNS = 600;

    while (winner(state) === null && turns < MAX_TURNS) {
      const r = roll(rng);
      const dice = expandDice(r);
      state = playTurn(state, dice, 'medium');
      turns++;
    }

    expect(winner(state)).not.toBeNull();
    expect(turns).toBeLessThan(MAX_TURNS);
  }, 30000);

  it('easy AI plays only legal moves over many turns', () => {
    const rng = seededRng(7);
    let state = initialBoard();
    for (let i = 0; i < 100 && winner(state) === null; i++) {
      const r = roll(rng);
      state = playTurn(state, expandDice(r), 'easy');
    }
    // No illegal-move throws is the assertion; if we got here, all good.
    expect(true).toBe(true);
  });

  it('AI handles a forced-pass turn (no legal moves) cleanly', () => {
    // White boxed in: only at 11, dice 1+2 both blocked
    let state: BoardState = {
      points: Array.from({ length: 24 }, (_, i) => {
        if (i === 11) return { owner: 'white' as const, count: 1 };
        if (i === 12 || i === 13) return { owner: 'black' as const, count: 3 };
        return { owner: null, count: 0 };
      }),
      bar: { white: 0, black: 0 },
      off: { white: 0, black: 0 },
      turn: 'white',
    };
    const result = pickMove(state, [1, 2] as Die[], 'medium');
    expect(result.moves).toEqual([]);
    state = endTurn(state);
    expect(state.turn).toBe('black');
  });
});
