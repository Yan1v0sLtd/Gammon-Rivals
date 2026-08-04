import type {BoardState, Player, Point} from "../types"

type PointSpec = readonly [Player, number]

export type BoardSpec = {
  points?: Readonly<Record<number, PointSpec>>,
  bar?: Partial<Record<Player, number>>,
  off?: Partial<Record<Player, number>>,
  turn?: Player,
}

export function makeBoard(spec: BoardSpec = {}): BoardState {
  const points: Point[] = Array.from({length: 24}, () => ({owner: null, count: 0}))
  for (const [idx, val] of Object.entries(spec.points ?? {})) {
    const [owner, count] = val
    points[Number(idx)] = {owner, count}
  }
  return {
    points,
    bar: {white: 0, black: 0, ...spec.bar},
    off: {white: 0, black: 0, ...spec.off},
    turn: spec.turn ?? "white",
  }
}
