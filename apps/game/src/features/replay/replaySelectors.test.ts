import { describe, expect, it } from 'vitest';
import { applyMove, endTurn } from '../../../../../packages/engine/src/rules';
import { initialBoard } from '../../../../../packages/engine/src/board';
import { BAR, OFF } from '../../../../../packages/engine/src/types';
import type { BoardState } from '../../../../../packages/engine/src/types';
import type { ReplayState } from './replaySlice';
import {
  decodePosition,
  reconstructStates,
  selectClampedPly,
  selectCurrentBoard,
  selectIsPlaying,
  selectReconstructedStates,
  selectTotalPlies,
} from './replaySelectors';
import { makeGame, makeTwoMoveGame } from './testFixtures';

const stateAfterWhiteOne: BoardState = endTurn(
  applyMove(initialBoard(), { from: 0, to: 1, die: 1, hit: false }),
);

const stateAfterBlackTwo: BoardState = endTurn(
  applyMove(stateAfterWhiteOne, { from: 23, to: 22, die: 1, hit: false }),
);

function replayState(overrides: Partial<ReplayState> = {}): ReplayState {
  return { ply: 0, playing: false, ...overrides };
}

describe('decodePosition', () => {
  it('maps bar and off sentinels back to engine positions', () => {
    expect(decodePosition('bar')).toBe(BAR);
    expect(decodePosition('off')).toBe(OFF);
    expect(decodePosition(7)).toBe(7);
  });
});

describe('with no replay data', () => {
  it('reports zero plies and no current board', () => {
    const state = { replay: replayState() };
    expect(selectReconstructedStates(state, undefined)).toEqual([]);
    expect(selectTotalPlies(state, undefined)).toBe(0);
    expect(selectClampedPly(state, undefined)).toBe(0);
    expect(selectCurrentBoard(state, undefined)).toBeNull();
    expect(selectIsPlaying(state, undefined)).toBe(false);
  });

  it('never reports playing when there is nothing to play', () => {
    const state = { replay: replayState({ playing: true }) };
    expect(selectIsPlaying(state, undefined)).toBe(false);
  });
});

describe('reconstructStates', () => {
  it('starts from the engine initial board for an empty move list', () => {
    expect(reconstructStates(makeGame({ moves: [] }))).toEqual([initialBoard()]);
  });

  it('applies a persisted sub-move with engine rules and ends the turn', () => {
    expect(reconstructStates(makeGame())).toEqual([initialBoard(), stateAfterWhiteOne]);
  });

  it('applies consecutive persisted moves for both players', () => {
    expect(reconstructStates(makeTwoMoveGame())).toEqual([
      initialBoard(),
      stateAfterWhiteOne,
      stateAfterBlackTwo,
    ]);
  });
});

describe('total and clamped ply', () => {
  it('derives total plies from the reconstructed states', () => {
    const state = { replay: replayState() };
    expect(selectTotalPlies(state, makeGame())).toBe(1);
    expect(selectTotalPlies(state, makeTwoMoveGame())).toBe(2);
  });

  it('clamps a negative raw ply to zero', () => {
    const state = { replay: replayState({ ply: -4 }) };
    expect(selectClampedPly(state, makeGame())).toBe(0);
  });

  it('clamps an oversized raw ply down to the total', () => {
    const state = { replay: replayState({ ply: 99 }) };
    expect(selectClampedPly(state, makeTwoMoveGame())).toBe(2);
  });

  it('clamps a raw ply beyond an empty replay to zero', () => {
    const state = { replay: replayState({ ply: 3 }) };
    expect(selectClampedPly(state, makeGame({ moves: [] }))).toBe(0);
  });
});

describe('current board and playback completion', () => {
  it('selects the board matching the clamped ply', () => {
    const state = { replay: replayState({ ply: 1 }) };
    expect(selectCurrentBoard(state, makeGame())).toEqual(stateAfterWhiteOne);
  });

  it('falls back to the initial board at ply zero', () => {
    const state = { replay: replayState({ ply: 0 }) };
    expect(selectCurrentBoard(state, makeGame())).toEqual(initialBoard());
  });

  it('derives playback from raw state before the end', () => {
    const state = { replay: replayState({ playing: true, ply: 0 }) };
    expect(selectIsPlaying(state, makeGame())).toBe(true);
  });

  it('derives completion when the clamped ply sits at the total', () => {
    const state = { replay: replayState({ playing: true, ply: 1 }) };
    expect(selectIsPlaying(state, makeGame())).toBe(false);
  });

  it('derives completion even when the raw ply overruns the total', () => {
    const state = { replay: replayState({ playing: true, ply: 9 }) };
    expect(selectIsPlaying(state, makeGame())).toBe(false);
  });
});
