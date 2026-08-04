import type {BoardState, Player} from "./types"

export type CubeValue = 1 | 2 | 4 | 8 | 16 | 32 | 64

export type WinType = "single" | "gammon" | "backgammon"

export const WIN_MULTIPLIER: Readonly<Record<WinType, number>> = {
  single: 1,
  gammon: 2,
  backgammon: 3,
}

export type MatchScore = {
  readonly white: number,
  readonly black: number,
}

export type CubeState = {
  readonly value: CubeValue,
  readonly owner: Player | null,
}

export type MatchState = {
  readonly target: number,
  readonly score: MatchScore,
  readonly gameNumber: number,
  readonly crawfordGameNumber: number | null,
  readonly cube: CubeState,
  readonly cubeOffer: Player | null,
  readonly winner: Player | null,
}

export type GameResult = {
  readonly winner: Player,
  readonly winType: WinType,
  readonly cubeValue: CubeValue,
  readonly points: number,
  readonly droppedDouble: boolean,
}

const opp = (p: Player): Player => (p === "white" ? "black" : "white")

export function newMatch(target: number): MatchState {
  if (target < 1) throw new Error("match target must be >= 1")
  return {
    target,
    score: {white: 0, black: 0},
    gameNumber: 1,
    crawfordGameNumber: null,
    cube: {value: 1, owner: null},
    cubeOffer: null,
    winner: null,
  }
}

export function classifyWin(state: BoardState, winner: Player): WinType {
  const loser = opp(winner)
  if (state.off[loser] > 0) return "single"
  if (state.bar[loser] > 0) return "backgammon"

  const [lo, hi] = winner === "white" ? [18, 23] : [0, 5]
  for (let i = lo; i <= hi; i++) {
    const pt = state.points[i]
    if (pt?.owner === loser && pt.count > 0) return "backgammon"
  }
  return "gammon"
}

export function isCrawfordGame(match: MatchState): boolean {
  return match.crawfordGameNumber !== null && match.crawfordGameNumber === match.gameNumber
}

export function canOfferDouble(match: MatchState, player: Player): boolean {
  if (match.winner !== null) return false
  // 1-point match (single game): the cube is dead — you can never use more than
  // the one point at stake, so doubling is meaningless. Keeps the cube out of
  // quick single-game matches for both human and AI.
  if (match.target <= 1) return false
  if (match.cubeOffer !== null) return false
  if (isCrawfordGame(match)) return false
  if (match.cube.value >= 64) return false
  if (match.cube.owner === null) return true
  return match.cube.owner === player
}

export function offerDouble(match: MatchState, player: Player): MatchState {
  if (!canOfferDouble(match, player)) {
    throw new Error("cannot offer double")
  }
  return {...match, cubeOffer: player}
}

export function acceptDouble(match: MatchState): MatchState {
  if (match.cubeOffer === null) throw new Error("no double offered")
  const offerer = match.cubeOffer
  const next = match.cube.value * 2
  if (next > 64) throw new Error("cube would exceed 64")
  return {
    ...match,
    cube: {value: next as CubeValue, owner: opp(offerer)},
    cubeOffer: null,
  }
}

/** Compute the GameResult for a dropped double. */
export function computeDropResult(match: MatchState): GameResult {
  if (match.cubeOffer === null) throw new Error("no double offered")
  return {
    winner: match.cubeOffer,
    winType: "single",
    cubeValue: match.cube.value,
    points: match.cube.value,
    droppedDouble: true,
  }
}

/** Opponent drops the offered double — game ends, offerer wins pre-double cube value. */
export function dropDouble(match: MatchState): MatchState {
  return applyGameResult(match, computeDropResult(match))
}

/** Compute the GameResult for a bear-off win without applying it. */
export function computeBearOffResult(
  match: MatchState,
  state: BoardState,
  winner: Player,
): GameResult {
  const winType = classifyWin(state, winner)
  return {
    winner,
    winType,
    cubeValue: match.cube.value,
    points: WIN_MULTIPLIER[winType] * match.cube.value,
    droppedDouble: false,
  }
}

/** Game won by bearing off all 15 checkers. */
export function gameWonByBearOff(
  match: MatchState,
  state: BoardState,
  winner: Player,
): MatchState {
  return applyGameResult(match, computeBearOffResult(match, state, winner))
}

export function applyGameResult(match: MatchState, result: GameResult): MatchState {
  const score: MatchScore = {
    white: match.score.white + (result.winner === "white" ? result.points : 0),
    black: match.score.black + (result.winner === "black" ? result.points : 0),
  }

  const matchOver = score.white >= match.target || score.black >= match.target
  const matchWinner: Player | null = matchOver
    ? score.white >= match.target
      ? "white"
      : "black"
    : null

  // Crawford detection: first time a player reaches target - 1, the next game is Crawford
  const oldMax = Math.max(match.score.white, match.score.black)
  const newMax = Math.max(score.white, score.black)
  const crawfordGameNumber =
    match.crawfordGameNumber === null && oldMax < match.target - 1 && newMax === match.target - 1
      ? match.gameNumber + 1
      : match.crawfordGameNumber

  return {
    ...match,
    score,
    gameNumber: matchOver ? match.gameNumber : match.gameNumber + 1,
    crawfordGameNumber,
    cube: {value: 1, owner: null},
    cubeOffer: null,
    winner: matchWinner,
  }
}
