export type Player = 'white' | 'black';

export type Die = 1 | 2 | 3 | 4 | 5 | 6;

export type DiceRoll = readonly [Die, Die];

export const BAR = 'bar' as const;
export const OFF = 'off' as const;

export type Position = number | typeof BAR | typeof OFF;

export interface Point {
  readonly owner: Player | null;
  readonly count: number;
}

export interface BoardState {
  readonly points: readonly Point[];
  readonly bar: Readonly<Record<Player, number>>;
  readonly off: Readonly<Record<Player, number>>;
  readonly turn: Player;
}

export interface Move {
  readonly from: Position;
  readonly to: Position;
  readonly die: Die;
  readonly hit: boolean;
}

export interface TurnState {
  readonly roll: DiceRoll;
  readonly remaining: readonly Die[];
  readonly history: readonly Move[];
}
