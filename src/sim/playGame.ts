/**
 * Headless self-play harness. Reuses the pure engine + the synchronous AI
 * picker to play complete games with no UI, no Worker, no Supabase — so we can
 * Monte-Carlo strength match-ups and feed real win rates into the economy
 * model. (Task #145 / #134 — Monte Carlo engine + runner.)
 *
 * Determinism: pass a seeded Rng; both the dice (roll) and the AI's random
 * choices (easy level) draw from it, so a (seed) fully reproduces a run.
 */
import {
  applyMove,
  classifyWin,
  endTurn,
  expandDice,
  initialBoard,
  roll,
  winner,
  WIN_MULTIPLIER,
  type BoardState,
  type Die,
  type Move,
  type Player,
  type Rng,
  type WinType,
} from '../engine';
import { pickMove } from '../ai/picker';
import { pickMoveSoftmax } from '../ai/strength';
import type { AILevel } from '../ai/types';

/** A turn policy: given the board + this turn's remaining dice, return the moves to play. */
export type Picker = (
  state: BoardState,
  remaining: readonly Die[],
  rng: Rng
) => readonly Move[];

/** Wrap the existing 3-tier AI picker as a Picker. */
export function leveled(level: AILevel): Picker {
  return (state, remaining, rng) => pickMove(state, remaining, level, rng).moves;
}

/**
 * Smooth, tunable strength for rating-matching, via the softmax move policy:
 * temperature 0 = strongest (best move every turn, == medium), higher
 * temperature = gradually weaker, large temperature ~= random (== easy).
 * Replaces the earlier per-move blunder coin-flip, which collapsed win rate
 * far too fast to be matchable. (Task #146.)
 */
export function softmaxPicker(temperature: number): Picker {
  return (state, remaining, rng) => pickMoveSoftmax(state, remaining, temperature, rng);
}

export interface GameOutcome {
  readonly winner: Player;
  readonly winType: WinType;
  /** Game value at cube=1: 1 single / 2 gammon / 3 backgammon. */
  readonly points: number;
  /** Number of half-turns played (a stall guard, also a pacing signal). */
  readonly plies: number;
}

/** Play one full game (white moves first, as in initialBoard). */
export function playGame(
  white: Picker,
  black: Picker,
  rng: Rng,
  maxPlies = 4_000
): GameOutcome {
  let state = initialBoard();
  for (let plies = 1; plies <= maxPlies; plies++) {
    const remaining = expandDice(roll(rng));
    const picker = state.turn === 'white' ? white : black;
    for (const m of picker(state, remaining, rng)) {
      state = applyMove(state, m);
    }
    const w = winner(state);
    if (w) {
      const winType = classifyWin(state, w);
      return { winner: w, winType, points: WIN_MULTIPLIER[winType], plies };
    }
    state = endTurn(state);
  }
  throw new Error(`playGame exceeded ${maxPlies} plies — likely a stalled strategy`);
}

export interface MatchupResult {
  readonly games: number;
  /** Win rate for picker A, color-balanced (A is white in even games, black in odd). */
  readonly aWinRate: number;
  /** Share of all games ending in each win type (cube=1 economics input). */
  readonly winTypeShare: Record<WinType, number>;
  readonly avgPlies: number;
}

/**
 * Run `games` games between A and B, alternating which side is white so the
 * first-move advantage washes out. Returns A's overall win rate.
 */
export function runFair(a: Picker, b: Picker, games: number, rng: Rng): MatchupResult {
  let aWins = 0;
  let totalPlies = 0;
  const types: Record<WinType, number> = { single: 0, gammon: 0, backgammon: 0 };
  for (let i = 0; i < games; i++) {
    const aIsWhite = i % 2 === 0;
    const out = playGame(aIsWhite ? a : b, aIsWhite ? b : a, rng);
    if ((out.winner === 'white') === aIsWhite) aWins++;
    types[out.winType] += 1;
    totalPlies += out.plies;
  }
  return {
    games,
    aWinRate: aWins / games,
    winTypeShare: {
      single: types.single / games,
      gammon: types.gammon / games,
      backgammon: types.backgammon / games,
    },
    avgPlies: totalPlies / games,
  };
}
