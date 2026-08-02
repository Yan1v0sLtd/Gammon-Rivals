import { createSelector } from '@reduxjs/toolkit';
import { applyMove, endTurn } from '../../../../../packages/engine/src/rules';
import { initialBoard } from '../../../../../packages/engine/src/board';
import { BAR, OFF } from '../../../../../packages/engine/src/types';
import type { BoardState, Die, Move, Position } from '../../../../../packages/engine/src/types';
import type { GameWithMoves } from '../../lib/queries';
import type { ReplayState } from './replaySlice';

export interface ReplayRootShape {
  readonly replay: ReplayState;
}

export interface SubMove {
  readonly from: number | 'bar';
  readonly to: number | 'off';
  readonly die: number;
  readonly hit: boolean;
}

export function decodePosition(p: number | 'bar' | 'off'): Position {
  if (p === 'bar') return BAR;
  if (p === 'off') return OFF;
  return p;
}

export function reconstructStates(data: GameWithMoves): BoardState[] {
  const states: BoardState[] = [initialBoard()];
  let s = states[0]!;
  for (const moveRow of data.moves) {
    const subs = (moveRow.sub_moves as unknown) as readonly SubMove[];
    for (const sub of subs) {
      const move: Move = {
        from: decodePosition(sub.from),
        to: decodePosition(sub.to),
        die: sub.die as Die,
        hit: sub.hit,
      };
      s = applyMove(s, move);
    }
    s = endTurn(s);
    states.push(s);
  }
  return states;
}

const selectPly = (state: ReplayRootShape) => state.replay.ply;
const selectPlaying = (state: ReplayRootShape) => state.replay.playing;

export const selectReconstructedStates = createSelector(
  [(_state: ReplayRootShape, data: GameWithMoves | undefined) => data],
  (data) => (data ? reconstructStates(data) : []),
);

export const selectTotalPlies = createSelector(
  [selectReconstructedStates],
  (states) => (states.length > 0 ? states.length - 1 : 0),
);

export const selectClampedPly = createSelector(
  [selectPly, selectTotalPlies],
  (ply, totalPlies) => Math.min(Math.max(0, ply), totalPlies),
);

export const selectCurrentBoard = createSelector(
  [selectClampedPly, selectReconstructedStates],
  (ply, states) => states[ply] ?? null,
);

export const selectIsPlaying = createSelector(
  [selectPlaying, selectClampedPly, selectTotalPlies],
  (playing, ply, totalPlies) => playing && ply < totalPlies,
);
