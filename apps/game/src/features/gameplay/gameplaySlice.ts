import type {PayloadAction} from "@reduxjs/toolkit"
import {createSlice} from "@reduxjs/toolkit"

import type {AILevel} from "../../../../../packages/ai/src/types"
import {initialBoard} from "../../../../../packages/engine/src/board"
import {expandDice, roll as rollDie} from "../../../../../packages/engine/src/dice"
import {
  acceptDouble as engineAcceptDouble,
  applyGameResult,
  canOfferDouble,
  computeBearOffResult,
  computeDropResult,
  type GameResult,
  type MatchState,
  newMatch as newMatchState,
  offerDouble as engineOfferDouble,
} from "../../../../../packages/engine/src/match"
import {
  applyMove, endTurn as engineEndTurn, legalMoves, winner as engineWinner,
} from "../../../../../packages/engine/src/rules"
import type {BoardState, DiceRoll, Die, Move, Player, Position} from "../../../../../packages/engine/src/types"
import {DICE_ANIMATION_MS} from "../../components/diceTiming"

/* Quick-match default: every match is a single 1-point game. The
 * engine still supports N-point matches with Crawford + the cube (see
 * packages/engine/src/match.ts and its 32 tests) — that infrastructure stays
 * around for tournaments. Callers (lobby, online match creation, the
 * /hotseat?target=N URL param) can still pass a larger target if they
 * need it. */
export const DEFAULT_TARGET = 1
export const DEFAULT_TURN_SECONDS = 45

export const AI_ROLL_DELAY = 500
export const AI_PER_MOVE_DELAY = 900
export const AI_END_TURN_DELAY = 400
export const AI_CUBE_DECISION_DELAY = 800
/** Brief pause after the board is revealed before auto-roll throws the dice. */
export const AUTO_ROLL_DELAY = 350
// Wait at least this long after rolling before applying any move so the
// dice physics + center tween can finish.
export const AI_DICE_SETTLE_MS = DICE_ANIMATION_MS

export type AIConfig = {
  readonly player: Player,
  readonly level: AILevel,
}

export type TurnRecord = {
  readonly player: Player,
  readonly dice: DiceRoll,
  readonly subMoves: readonly Move[],
  /**
   * Epoch ms when the turn started (the roll that opened it). Used to
   * compute elapsedMs at end-of-turn — we don't store the elapsed value
   * incrementally because the AI may insert intermediate turns and we
   * only care about the wall-clock distance from roll to submit on the
   * turn this record is for.
   */
  readonly startedAt: number,
  /**
   * Player's think-time on this turn, in milliseconds. Populated when
   * the turn ends (endTurn / forfeitTurn / engineEndTurn auto-fire).
   * Null until the turn is closed; null for AI turns (their wall-clock
   * is dominated by think delay, not player decision, and we don't
   * want that polluting the bot-detection signal).
   */
  readonly elapsedMs: number | null,
}

/**
 * Snapshot captured immediately before a checker move is applied. Holds
 * exactly what's needed to roll back ONE move — board state, the dice
 * still available, the move history, and the per-turn log. We keep the
 * most recent snapshot only; chaining multiple undos isn't supported by
 * design.
 */
export type MoveSnapshot = {
  readonly board: BoardState,
  readonly remaining: readonly Die[],
  readonly history: readonly Move[],
  readonly turnLog: readonly TurnRecord[],
}

export type GameplayState = {
  /** Database identifier only; the match server row stays outside this slice. */
  readonly matchId: string | null,
  readonly match: MatchState,
  readonly board: BoardState,
  readonly roll: DiceRoll | null,
  readonly remaining: readonly Die[],
  readonly selectedFrom: Position | null,
  readonly history: readonly Move[],
  readonly turnLog: readonly TurnRecord[],
  readonly undoSnapshot: MoveSnapshot | null,
  readonly lastGameResult: GameResult | null,
  readonly ai: AIConfig | null,
  /** Epoch ms deadline for the visible/current turn timer, or null when paused. */
  readonly turnDeadlineMs: number | null,
  /** Per-session timer configuration supplied by the route entry payload. */
  readonly turnSeconds: number,
  readonly turnTimerEnabled: boolean,
  readonly isAIThinking: boolean,
  readonly aiPreviewReady: boolean,
}

export function createInitialGameplayState(): GameplayState {
  return {
    matchId: null,
    match: newMatchState(DEFAULT_TARGET),
    board: initialBoard(),
    roll: null,
    remaining: [],
    selectedFrom: null,
    history: [],
    turnLog: [],
    undoSnapshot: null,
    lastGameResult: null,
    ai: null,
    turnDeadlineMs: null,
    turnSeconds: DEFAULT_TURN_SECONDS,
    turnTimerEnabled: true,
    isAIThinking: false,
    aiPreviewReady: false,
  }
}

// Immer's reducer draft strips the `readonly` modifier from properties but
// keeps the engine's immutable value types (BoardState, readonly arrays),
// so assigning a fresh engine result into the draft needs this shape.
type MutableGameplayState = {
  -readonly [K in keyof GameplayState]: GameplayState[K];
}

const gameFrozen = (s: GameplayState): boolean => s.lastGameResult !== null || s.match.winner !== null

// Mirrors the selector's legal-moves derivation (selectLegalMoves): dice must
// be present and the game must not be frozen, or no move is legal.
function legalMovesFor(s: GameplayState): readonly Move[] {
  if (s.remaining.length === 0) return []
  if (gameFrozen(s)) return []
  return legalMoves(s.board, s.remaining)
}

/**
 * Stamps elapsedMs on the latest turn record. Called from the end-turn
 * and forfeit reducers — the two places a turn "closes" from the player's
 * perspective. AI turns also pass through endTurn, but we skip the
 * stamping for those so the elapsed_ms column on moves stays
 * AI-free (their think-time is a different signal entirely). The clock
 * value is `endedAt - startedAt` from the payload — never a reducer-side
 * clock read.
 */
function closeTurnTiming(s: MutableGameplayState, endedAt: number): void {
  if (s.turnLog.length === 0) return
  const last = s.turnLog[s.turnLog.length - 1]
  if (last.elapsedMs !== null) return // already closed
  if (s.ai !== null && last.player === s.ai.player) return
  s.turnLog = [...s.turnLog.slice(0, -1), {
    ...last,
    elapsedMs: Math.max(0, endedAt - last.startedAt),
  }]
}

/** Reset the per-turn/per-game fields while keeping the given canonical
 *  match/board/ai (used by route entry, next game and new match). */
function resetSession(s: MutableGameplayState): void {
  s.roll = null
  s.remaining = []
  s.selectedFrom = null
  s.history = []
  s.turnLog = []
  s.undoSnapshot = null
  s.lastGameResult = null
  s.turnDeadlineMs = null
  s.isAIThinking = false
  s.aiPreviewReady = false
}

/** Fresh game board with a RANDOM opening player. Real backgammon decides who
 *  moves first by a roll-off; we model that as a coin-flip on the starting turn
 *  so the human doesn't always open (and the AI sometimes does). When black (the
 *  AI) opens, the gameplay listener auto-plays it — board.turn === ai.player on
 *  route entry, so no human action is needed for the AI's first turn. */
function randomFirstBoard(): BoardState {
  const b = initialBoard()
  return Math.random() < 0.5 ? b : {
    ...b,
    turn: "black",
  }
}

type RouteEnteredArgs = {
  readonly sessionId: string,
  readonly presetMatchId: string | null,
  readonly target: number,
  readonly ai: AIConfig | null,
  readonly turnSeconds: number,
  readonly turnTimerEnabled: boolean,
}

type RouteEnteredPayload = {
  readonly board: BoardState,
} & RouteEnteredArgs

type MatchIdAssignedPayload = {
  readonly matchId: string,
}

type DiceRolledPayload = {
  readonly roll: DiceRoll,
  /** Epoch ms when the roll opened the turn — read by this action's `prepare`
   *  callback so the reducer stays clock-free. */
  readonly startedAt: number,
}

type CheckerSelectedPayload = {
  readonly from: Position,
}

type CheckerMovedPayload = {
  readonly from: Position,
  readonly to: Position,
  /** The die consumed by this move. Omitted for human play (a from/to pair is
   *  unique in the legal set because each die value yields one target); supplied
   *  for AI play so ambiguous bear-off moves keep the exact die from the plan. */
  readonly die?: Die,
}

type TurnEndedPayload = {
  /** Epoch ms when the turn closed, for the elapsed_ms stamp. */
  readonly endedAt: number,
  /** Bypass the canEndTurn guard. The old AI unconditionally switched turns
   *  after its plan; normal human end-turns stay guarded. */
  readonly force: boolean,
}

type TurnForfeitedPayload = {
  readonly endedAt: number,
  /** Expected turn owner, or null for an unguarded forfeit. When a player is
   *  given, the reducer no-ops if the board's turn no longer belongs to them —
   *  that keeps the AI failure recovery from clobbering a turn that already
   *  moved on. Callers may omit it; `prepare` normalises the absence to null,
   *  which is how ordinary human forfeits stay unguarded. */
  readonly expectedPlayer: Player | null,
}

type GameContinuedPayload = {
  readonly board: BoardState,
}

export const gameplaySlice = createSlice({
  name: "gameplay",
  initialState: createInitialGameplayState(),
  reducers: {
    gameplayRouteEntered: {
      reducer: (state, action: PayloadAction<RouteEnteredPayload>) => {
        const s: MutableGameplayState = state
        s.matchId = action.payload.presetMatchId
        s.match = newMatchState(action.payload.target)
        s.board = action.payload.board
        s.ai = action.payload.ai
        s.turnSeconds = action.payload.turnSeconds
        s.turnTimerEnabled = action.payload.turnTimerEnabled
        resetSession(s)
      },
      prepare: (args: RouteEnteredArgs) => ({
        payload: {
          ...args,
          board: randomFirstBoard(),
        },
      }),
    },
    gameplayRouteExited: () => createInitialGameplayState(),
    matchIdAssigned: (state, action: PayloadAction<MatchIdAssignedPayload>) => {
      if (state.matchId !== null) return
      state.matchId = action.payload.matchId
    },
    diceRolled: {
      reducer: (state, action: PayloadAction<DiceRolledPayload>) => {
        const s: MutableGameplayState = state
        if (s.roll !== null) return
        if (gameFrozen(s)) return
        if (s.match.cubeOffer !== null) return
        const roll = action.payload.roll
        s.roll = roll
        s.remaining = expandDice(roll)
        s.selectedFrom = null
        s.history = []
        s.undoSnapshot = null
        s.aiPreviewReady = false
        s.turnLog = [...s.turnLog, {
          player: s.board.turn,
          dice: roll,
          subMoves: [],
          startedAt: action.payload.startedAt,
          elapsedMs: null,
        }]
      },
      prepare: () => ({
        payload: {
          roll: rollDie(),
          startedAt: Date.now(),
        },
      }),
    },
    checkerSelected: (state, action: PayloadAction<CheckerSelectedPayload>) => {
      const s: MutableGameplayState = state
      const from = action.payload.from
      if (!legalMovesFor(s).some((m) => m.from === from)) {
        s.selectedFrom = null
        return
      }
      s.selectedFrom = from
    },
    checkerSelectionCancelled: (state) => {
      const s: MutableGameplayState = state
      s.selectedFrom = null
    },
    checkerMoved: (state, action: PayloadAction<CheckerMovedPayload>) => {
      const s: MutableGameplayState = state
      const {
        from,
        to,
        die,
      } = action.payload
      const move = die === undefined ? legalMovesFor(s).find((m) => m.from === from && m.to === to) : legalMovesFor(s).find((m) => m.from === from && m.to === to && m.die === die)
      if (!move) return

      const next = applyMove(s.board, move)
      const dieIdx = s.remaining.indexOf(move.die)
      const nextRemaining = dieIdx >= 0 ? [...s.remaining.slice(0, dieIdx), ...s.remaining.slice(dieIdx + 1)] : [...s.remaining]

      // Snapshot the current state BEFORE we commit the move so the user
      // can undo it. We only keep the most recent move's snapshot.
      s.undoSnapshot = {
        board: s.board,
        remaining: s.remaining,
        history: s.history,
        turnLog: s.turnLog,
      }

      s.board = next
      s.remaining = nextRemaining
      s.history = [...s.history, move]
      s.selectedFrom = null

      if (s.turnLog.length > 0) {
        const last = s.turnLog[s.turnLog.length - 1]
        s.turnLog = [...s.turnLog.slice(0, -1), {
          ...last,
          subMoves: [...last.subMoves, move],
        }]
      }

      const w = engineWinner(next)
      if (w) {
        const result = computeBearOffResult(s.match, next, w)
        s.match = applyGameResult(s.match, result)
        s.lastGameResult = result
        // Game ended — undo would be confusing once the result modal is up.
        s.undoSnapshot = null
      }
    },
    lastMoveUndone: (state) => {
      const s: MutableGameplayState = state
      if (s.undoSnapshot === null) return
      if (gameFrozen(s)) return
      if (s.ai !== null && s.board.turn === s.ai.player) return
      s.board = s.undoSnapshot.board
      s.remaining = s.undoSnapshot.remaining
      s.history = s.undoSnapshot.history
      s.turnLog = s.undoSnapshot.turnLog
      s.selectedFrom = null
      s.undoSnapshot = null
    },
    turnEnded: {
      reducer: (state, action: PayloadAction<TurnEndedPayload>) => {
        const s: MutableGameplayState = state
        const canEnd = s.roll !== null && !gameFrozen(s) && (s.remaining.length === 0 || legalMovesFor(s).length === 0)
        if (!action.payload.force && !canEnd) return
        closeTurnTiming(s, action.payload.endedAt)
        s.board = engineEndTurn(s.board)
        s.roll = null
        s.remaining = []
        s.selectedFrom = null
        s.history = []
        s.undoSnapshot = null
        s.aiPreviewReady = false
      },
      prepare: (args?: {readonly force?: boolean}) => ({
        payload: {
          endedAt: Date.now(),
          force: args?.force ?? false,
        },
      }),
    },
    turnForfeited: {
      reducer: (state, action: PayloadAction<TurnForfeitedPayload>) => {
        const s: MutableGameplayState = state
        const {
          endedAt,
          expectedPlayer,
        } = action.payload
        if (expectedPlayer !== null && s.board.turn !== expectedPlayer) return
        if (gameFrozen(s)) return
        if (s.match.cubeOffer !== null) return
        closeTurnTiming(s, endedAt)
        s.board = engineEndTurn(s.board)
        s.roll = null
        s.remaining = []
        s.selectedFrom = null
        s.history = []
        s.undoSnapshot = null
        s.aiPreviewReady = false
      },
      prepare: (args?: {readonly expectedPlayer?: Player}) => ({
        payload: {
          endedAt: Date.now(),
          expectedPlayer: args?.expectedPlayer ?? null,
        },
      }),
    },
    doubleOffered: (state) => {
      const s: MutableGameplayState = state
      if (s.roll !== null) return
      if (gameFrozen(s)) return
      if (s.ai !== null && s.board.turn === s.ai.player) return // isAITurn
      if (s.match.cubeOffer !== null) return
      if (!canOfferDouble(s.match, s.board.turn)) return
      s.match = engineOfferDouble(s.match, s.board.turn)
    },
    doubleAccepted: (state) => {
      const s: MutableGameplayState = state
      if (s.match.cubeOffer === null) return
      s.match = engineAcceptDouble(s.match)
    },
    doubleDropped: (state) => {
      const s: MutableGameplayState = state
      if (s.match.cubeOffer === null) return
      const result = computeDropResult(s.match)
      s.match = applyGameResult(s.match, result)
      s.lastGameResult = result
    },
    turnDeadlineChanged: (state, action: PayloadAction<{readonly deadlineMs: number | null}>) => {
      state.turnDeadlineMs = action.payload.deadlineMs
    },
    gameContinued: {
      reducer: (state, action: PayloadAction<GameContinuedPayload>) => {
        const s: MutableGameplayState = state
        if (s.lastGameResult === null) return
        if (s.match.winner !== null) return
        s.board = action.payload.board
        resetSession(s)
      },
      prepare: () => ({payload: {board: randomFirstBoard()}}),
    },

    aiThinkingChanged: (state, action: PayloadAction<{readonly thinking: boolean}>) => {
      state.isAIThinking = action.payload.thinking
    },
    aiPreviewReadyChanged: (state, action: PayloadAction<{readonly ready: boolean}>) => {
      state.aiPreviewReady = action.payload.ready
    },
  },
})

export const {
  gameplayRouteEntered,
  gameplayRouteExited,
  matchIdAssigned,
  diceRolled,
  checkerSelected,
  checkerSelectionCancelled,
  checkerMoved,
  lastMoveUndone,
  turnEnded,
  turnForfeited,
  doubleOffered,
  doubleAccepted,
  doubleDropped,
  turnDeadlineChanged,
  gameContinued,
  aiThinkingChanged,
  aiPreviewReadyChanged,
} = gameplaySlice.actions

export const gameplayReducer = gameplaySlice.reducer
