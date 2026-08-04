// GENERATED FILE — DO NOT EDIT.
// Deno mirror of packages/engine for Supabase edge functions (server-side
// move/outcome validation). packages/engine is the single source of truth;
// regenerate with:  npm run build:shared-engine

export type Player = "white" | "black"

export type Die = 1 | 2 | 3 | 4 | 5 | 6

export type DiceRoll = readonly [Die, Die]

export const BAR = "bar" as const
export const OFF = "off" as const

export type Position = number | typeof BAR | typeof OFF

export type Point = {
  readonly owner: Player | null,
  readonly count: number,
}

export type BoardState = {
  readonly points: readonly Point[],
  readonly bar: Readonly<Record<Player, number>>,
  readonly off: Readonly<Record<Player, number>>,
  readonly turn: Player,
}

export type Move = {
  readonly from: Position,
  readonly to: Position,
  readonly die: Die,
  readonly hit: boolean,
}

export type TurnState = {
  readonly roll: DiceRoll,
  readonly remaining: readonly Die[],
  readonly history: readonly Move[],
}
