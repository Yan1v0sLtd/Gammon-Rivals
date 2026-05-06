import type { BoardState, Player, Point } from './types';

const empty = (): Point => ({ owner: null, count: 0 });
const stack = (owner: Player, count: number): Point => ({ owner, count });

export function initialBoard(): BoardState {
  const points: Point[] = Array.from({ length: 24 }, empty);
  points[0] = stack('white', 2);
  points[11] = stack('white', 5);
  points[16] = stack('white', 3);
  points[18] = stack('white', 5);
  points[23] = stack('black', 2);
  points[12] = stack('black', 5);
  points[7] = stack('black', 3);
  points[5] = stack('black', 5);

  return {
    points,
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 },
    turn: 'white',
  };
}

export function pipCount(state: BoardState, player: Player): number {
  const homeDistance = (idx: number) =>
    player === 'white' ? 24 - idx : idx + 1;

  let total = 0;
  state.points.forEach((p, idx) => {
    if (p.owner === player) total += p.count * homeDistance(idx);
  });
  total += state.bar[player] * 25;
  return total;
}
