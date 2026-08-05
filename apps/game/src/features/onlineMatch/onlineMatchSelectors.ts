import {createSelector} from "@reduxjs/toolkit"

import type {AILevel} from "../../../../../packages/ai/src/types"
import {initialBoard, pipCount} from "../../../../../packages/engine/src/board"
import {
  applyMove, endTurn as engineEndTurn, legalMoves, winner as engineWinner,
} from "../../../../../packages/engine/src/rules"
import type {BoardState, DiceRoll, Die, Move, Player, Position} from "../../../../../packages/engine/src/types"
import {BAR, OFF} from "../../../../../packages/engine/src/types"
import {generateAIPersona} from "../../lib/aiPersona"
import {createEmptyArray} from "../../lib/constants"
import {aiRankLabel} from "../../lib/identity"
import type {RootState} from "../../store/store"

import {finishTurnCacheKey, onlineMatchApi, rollDiceCacheKey} from "./onlineMatchApi"
import type {ActiveMatchSnapshot, GameRow, MatchRow, MoveRow} from "./onlineMatchData"
import type {OnlineMatchState} from "./onlineMatchSlice"
import {PRESENCE_FORFEIT_GRACE_MS} from "./onlineMatchSlice"

export type CubeValue = 1 | 2 | 4 | 8 | 16 | 32 | 64

export type SubMoveJSON = {
  readonly from: number | "bar",
  readonly to: number | "off",
  readonly die: number,
  readonly hit: boolean,
}

export type CurrentTurnJSON = {
  readonly player: Player,
  readonly dice: readonly [number, number],
  readonly remaining: readonly number[],
  readonly subMoves: readonly SubMoveJSON[],
}

export type OnlineMatchRootShape = {
  readonly onlineMatch: OnlineMatchState,
  readonly auth: {readonly userId: string | null},
}

export function decodeMove(s: SubMoveJSON): Move {
  const from: Position = s.from === "bar" ? BAR : s.from
  const to: Position = s.to === "off" ? OFF : s.to
  return {
    from,
    to,
    die: s.die as Die,
    hit: s.hit,
  }
}

export function encodeFrom(p: Position): number | "bar" {
  if (p === OFF) throw new Error("cannot move from off")
  if (p === BAR) return "bar"
  return p
}

export function encodeTo(p: Position): number | "off" {
  if (p === BAR) throw new Error("cannot move to bar")
  if (p === OFF) return "off"
  return p
}

export function encodeMove(m: Move): SubMoveJSON {
  return {
    from: encodeFrom(m.from),
    to: encodeTo(m.to),
    die: m.die,
    hit: m.hit,
  }
}

type DerivedState = {
  board: BoardState,
  currentTurn: CurrentTurnJSON | null,
  whoseTurn: Player, // logical turn (whose turn it is to play, not necessarily local)
}

function deriveState(moves: readonly MoveRow[], currentTurn: CurrentTurnJSON | null): DerivedState {
  let board = initialBoard()
  // Apply all completed turns. Each applyMove can throw if the move
  // row references a from/to that doesn't have the right checker —
  // a poisoned moves row would otherwise propagate the throw up
  // through React's render and the RouteErrorBoundary would catch
  // it. We tighten that here: on a bad move, log diagnostics + reset
  // to initialBoard for THAT turn segment, so the rest of the match
  // can still render. The diagnostics tell us exactly which row
  // and submove poisoned the state next time it happens.
  try {
    for (const moveRow of moves) {
      const subs = (moveRow.sub_moves as unknown as readonly SubMoveJSON[]) ?? []
      for (const sub of subs) {
        board = applyMove(board, decodeMove(sub))
      }
      board = engineEndTurn(board)
    }
    if (currentTurn && currentTurn.subMoves.length > 0) {
      for (const sub of currentTurn.subMoves) {
        board = applyMove(board, decodeMove(sub))
      }
    }
  }
  catch (err) {
    console.error("[onlineMatch] deriveState crashed — board state may be inconsistent", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      movesCount: moves.length,
      lastMoveSub: moves[moves.length - 1]?.sub_moves,
      currentTurn,
    })
    // Surface a recognisable signal so the UI can show "match
    // state recovery" instead of a silently-broken board.
    board = initialBoard()
  }
  const whoseTurn: Player = currentTurn ? currentTurn.player : moves.length === 0 ? "white" : moves[moves.length - 1].player === "white" ? "black" : "white"
  return {
    board,
    currentTurn,
    whoseTurn,
  }
}

const selectSnapshot = (state: RootState, matchId: string | undefined): ActiveMatchSnapshot | undefined => {
  // The query is skipped when matchId is absent; a cache lookup with a fake
  // argument would create an entry that never resolves.
  if (matchId === undefined) return undefined
  return onlineMatchApi.endpoints.getActiveMatch.select(matchId)(state).data
}

export const selectMatch = createSelector([
  selectSnapshot,
], (snap): MatchRow | null => snap?.match ?? null)

export const selectOwnerId = createSelector([
  selectMatch,
], (match): string | null => match?.owner_id ?? null)

export const selectOpponentId = createSelector([
  selectMatch,
], (match): string | null => match?.opponent_id ?? null)

export const selectIsBot = createSelector([
  selectMatch,
], (match): boolean => match?.is_bot === true)

export const selectOwnerColor = createSelector([
  selectMatch,
], (match): Player => match?.owner_color === "black" ? "black" : "white")

export const selectSpectatorColor = createSelector([
  selectOwnerColor,
  (_state: OnlineMatchRootShape, _matchId: string | undefined, seat: "self" | "opponent") => seat,
], (ownerColor, seat): Player => ownerColor === "black"
  ? seat === "opponent" ? "black" : "white"
  : seat === "opponent" ? "white" : "black")

export const selectSpectatorScore = createSelector([
  selectMatch, selectSpectatorColor,
], (match, color): number => color === "white" ? match?.white_score ?? 0 : match?.black_score ?? 0)

// Duplicate-command guards. Both commands are server-authoritative and reject
// the second call, so a double click — or the auto-action racing a manual
// click — must produce one write. The pending flag is read off the shared fixed
// cache key rather than kept in a ref, so every dispatcher sees the same value.
export const selectRollPending = (state: RootState, matchId: string | undefined): boolean => matchId !== undefined && onlineMatchApi.endpoints.rollDice.select({
  requestId: undefined,
  fixedCacheKey: rollDiceCacheKey(matchId),
})(state).isLoading

export const selectFinishTurnPending = (state: RootState, matchId: string | undefined): boolean => matchId !== undefined && onlineMatchApi.endpoints.finishTurn.select({
  requestId: undefined,
  fixedCacheKey: finishTurnCacheKey(matchId),
})(state).isLoading

export const selectMoves = createSelector([
  selectSnapshot,
], (snap): readonly MoveRow[] => snap?.moves ?? createEmptyArray<MoveRow>())

export const selectCurrentGame = createSelector([
  selectSnapshot,
], (snap): GameRow | null => snap?.currentGame ?? null)

// Shape validation matters here: replace_opponent_with_ai (the
// auto-forfeit RPC) merges a side-channel _abandonment object into
// current_turn so finish_match has an audit trail. If finalize then
// races / fails, we can land in a state where current_turn is
// `{_abandonment: {...}}` with NO engine fields. The downstream
// code (deriveState, the roll/remaining derivations, the auto-action
// key computation) all assume the engine shape — they
// crash on `undefined.length` / `undefined[0]` / `undefined.join`,
// taking the whole page blank. Validate the shape and treat a
// metadata-only object as "no turn in progress" instead.
export const selectCurrentTurn = createSelector([
  selectMatch,
], (match): CurrentTurnJSON | null => {
  const ct = match?.current_turn as unknown
  if (!ct || typeof ct !== "object") return null
  const c = ct as Partial<CurrentTurnJSON>
  if ((c.player !== "white" && c.player !== "black") || !Array.isArray(c.dice) || c.dice.length < 2 || !Array.isArray(c.remaining) || !Array.isArray(c.subMoves)) {
    return null
  }
  return c as CurrentTurnJSON
})

const selectDerived = createSelector([
  selectMoves, selectCurrentTurn,
], (moves, currentTurn) => deriveState(moves, currentTurn))

export const selectBoard = createSelector([
  selectDerived,
], (d): BoardState => d.board)

export const selectWhitePipCount = createSelector([
  selectBoard,
], (board): number => pipCount(board, "white"))

export const selectBlackPipCount = createSelector([
  selectBoard,
], (board): number => pipCount(board, "black"))

export const selectSpectatorSelfPipCount = createSelector([
  (state: RootState, matchId: string | undefined) => selectSpectatorColor(state, matchId, "self"),
  selectWhitePipCount,
  selectBlackPipCount,
], (color, whitePip, blackPip): number => color === "white" ? whitePip : blackPip)

export const selectSpectatorOpponentPipCount = createSelector([
  (state: RootState, matchId: string | undefined) => selectSpectatorColor(state, matchId, "opponent"),
  selectWhitePipCount,
  selectBlackPipCount,
], (color, whitePip, blackPip): number => color === "white" ? whitePip : blackPip)

export const selectWhoseTurn = createSelector([
  selectDerived,
], (d): Player => d.whoseTurn)

export const selectMatchFinished = createSelector([
  selectMatch,
], (match) => !!match?.finished_at)

const selectGameFinishedInDb = createSelector([
  selectCurrentGame,
], (game) => !!game?.finished_at)

// Between-games = the current game is finished but the match isn't.
// The board derives empty during this window because the next game hasn't started.
export const selectBetweenGames = createSelector([
  selectGameFinishedInDb, selectMatchFinished,
], (gameFinished, matchFinished) => gameFinished && !matchFinished)

// Between games, white always starts the next game (matches edge function expectation).
export const selectEffectiveTurn = createSelector([
  selectBetweenGames, selectWhoseTurn,
], (betweenGames, whoseTurn): Player => (betweenGames ? "white" : whoseTurn))

export const selectLocalColor = createSelector([
  selectMatch, (state: OnlineMatchRootShape) => state.auth.userId,
], (match, userId): Player | null => {
  if (!match || !userId) return null
  if (userId === match.owner_id) return match.owner_color === "black" ? "black" : "white"
  if (userId === match.opponent_id) return match.owner_color === "white" ? "black" : "white"
  return null
})

export const selectIsLocalTurn = createSelector([
  selectLocalColor, selectEffectiveTurn,
], (localColor, effectiveTurn) => localColor !== null && effectiveTurn === localColor)

// Crawford game: the first game played after either side first reached target-1.
// No doubling allowed during the Crawford game (post-Crawford resumes doubling).
export const selectInCrawfordGame = createSelector([
  selectMatch, selectCurrentGame, selectGameFinishedInDb,
], (match, currentGame, gameFinishedInDb) => !!match && match.crawford_game_number !== null && !!currentGame && match.crawford_game_number === currentGame.game_number && !gameFinishedInDb)

export const selectGameWinner = createSelector([
  selectBetweenGames, selectCurrentGame, selectBoard,
], (betweenGames, currentGame, board): Player | null => betweenGames ? (currentGame?.winner as Player | null) : engineWinner(board))

export const selectCubeValue = createSelector([
  selectMatch,
], (match): CubeValue => (match?.cube_value ?? 1) as CubeValue)

export const selectCubeOwner = createSelector([
  selectMatch,
], (match): Player | null => (match?.cube_owner ?? null) as Player | null)

export const selectCubeOffer = createSelector([
  selectMatch,
], (match): Player | null => (match?.cube_offer ?? null) as Player | null)

// Dice exposed to UI. Memoised so the array reference is stable across
// renders when the dice values haven't actually changed — DiceTray uses this
// as a useMemo dep, and a fresh-each-render reference re-computes the
// trajectory + restarts the throw animation every paint (the "dice spin
// forever and never land" bug). The memo keys are the dice values and the
// player, NOT the currentTurn reference: selectTo's optimistic patch replaces
// current_turn on every submove (same dice, more subMoves), and keying on the
// object would hand DiceTray a fresh array each submove. The player term keeps
// a new turn with identical dice restarting the animation.
const selectRollFirstDie = createSelector([
  selectCurrentTurn,
], (t) => t?.dice[0])
const selectRollSecondDie = createSelector([
  selectCurrentTurn,
], (t) => t?.dice[1])
const selectRollPlayer = createSelector([
  selectCurrentTurn,
], (t) => t?.player ?? null)

export const selectRoll = createSelector([
  selectRollFirstDie, selectRollSecondDie, selectRollPlayer,
], (firstDie, secondDie, rollPlayer): DiceRoll | null => {
  // Changing player must restart the animation even if both rolls match.
  void rollPlayer
  return firstDie !== undefined && secondDie !== undefined ? ([firstDie, secondDie] as DiceRoll) : null
})

export const selectRemaining = createSelector([
  selectCurrentTurn,
], (currentTurn): readonly Die[] => (currentTurn?.remaining ?? createEmptyArray<Die>()) as readonly Die[])

export const selectSelectedFrom = createSelector([
  (state: OnlineMatchRootShape) => state.onlineMatch.selectedFrom,
], (selectedFrom) => selectedFrom)

// Key of the opponent turn currently being previewed, or null when nothing is
// being previewed (local turn, no dice left, or the game ended).
export const selectOpponentPreviewKey = createSelector([
  selectCurrentTurn, selectIsLocalTurn, selectGameWinner,
], (currentTurn, isLocalTurn, gameWinner): string | null => currentTurn && !isLocalTurn && currentTurn.remaining.length > 0 && !gameWinner ? [currentTurn.player, currentTurn.dice.join("-"), currentTurn.remaining.join("-"), currentTurn.subMoves.length].join(":") : null)

export const selectOpponentPreviewReady = createSelector([
  selectOpponentPreviewKey, (state: OnlineMatchRootShape) => state.onlineMatch.opponentPreviewReadyKey,
], (key, readyKey) => key !== null && readyKey === key)

export const selectLocalLegalMoves = createSelector([
  selectCurrentTurn, selectIsLocalTurn, selectBoard, selectGameWinner,
], (currentTurn, isLocalTurn, board, gameWinner): readonly Move[] => {
  if (!currentTurn || !isLocalTurn || gameWinner) return createEmptyArray<Move>()
  if (currentTurn.remaining.length === 0) return createEmptyArray<Move>()
  return legalMoves(board, currentTurn.remaining as readonly Die[])
})

export const selectOpponentLegalMoves = createSelector([
  selectCurrentTurn, selectIsLocalTurn, selectBoard, selectGameWinner, selectOpponentPreviewReady,
], (currentTurn, isLocalTurn, board, gameWinner, previewReady): readonly Move[] => {
  if (!currentTurn || isLocalTurn || gameWinner || !previewReady) return createEmptyArray<Move>()
  if (currentTurn.remaining.length === 0) return createEmptyArray<Move>()
  return legalMoves(board, currentTurn.remaining as readonly Die[])
})

export const selectLegalOrigins = createSelector([
  selectLocalLegalMoves,
], (legal): readonly Position[] => {
  if (legal.length === 0) return createEmptyArray<Position>()
  const set = new Set<Position>()
  for (const m of legal) set.add(m.from)
  return Array.from(set)
})

export const selectValidDestinations = createSelector([
  selectLocalLegalMoves, selectSelectedFrom,
], (legal, selectedFrom): readonly Position[] => {
  if (selectedFrom === null || legal.length === 0) return createEmptyArray<Position>()
  return legal.filter((m) => m.from === selectedFrom).map((m) => m.to)
})

export type OnlineTimerViewModel = {
  readonly deadlineMs: number | null,
  readonly durationMs: number | null,
  readonly activePlayer: Player,
}

export const selectTimerViewModel = createSelector(
  [(state: OnlineMatchRootShape, matchId: string | undefined) => selectTurnDisplayDeadlineMs(state, matchId), (state: OnlineMatchRootShape) => state.onlineMatch.turnSeconds, selectEffectiveTurn],
  (deadlineMs, turnSeconds, activePlayer): OnlineTimerViewModel => ({
    deadlineMs,
    durationMs: turnSeconds === null ? null : turnSeconds * 1000,
    activePlayer,
  }),
)

export const selectBoardPositionViewModel = createSelector(
  [selectBoard, selectRoll, selectRemaining],
  (board, roll, remaining) => ({board, roll, remaining}),
)

export const selectOpponentPreviewOrigins = createSelector([
  selectOpponentLegalMoves,
], (legal): readonly Position[] => {
  if (legal.length === 0) return createEmptyArray<Position>()
  const set = new Set<Position>()
  for (const m of legal) set.add(m.from)
  return Array.from(set)
})

export const selectOpponentPreviewDestinations = createSelector([
  selectOpponentLegalMoves,
], (legal): readonly Position[] => {
  if (legal.length === 0) return createEmptyArray<Position>()
  const set = new Set<Position>()
  for (const m of legal) set.add(m.to)
  return Array.from(set)
})

export const selectSelectionViewModel = createSelector(
  [selectSelectedFrom, selectLegalOrigins, selectValidDestinations, selectOpponentPreviewOrigins, selectOpponentPreviewDestinations],
  (selectedFrom, legalOrigins, validDestinations, opponentOrigins, opponentDestinations) => ({
    selectedFrom,
    legalOrigins,
    validDestinations,
    opponentOrigins,
    opponentDestinations,
  }),
)

export const selectCanRoll = createSelector([
  selectMatchFinished, selectMatch, selectCurrentTurn, selectCubeOffer, selectIsLocalTurn,
], (matchFinished, match, currentTurn, cubeOffer, isLocalTurn) => !matchFinished && !!match && !!match.opponent_id && currentTurn === null && cubeOffer === null && isLocalTurn)

export const selectInteractionViewModel = createSelector(
  [selectIsLocalTurn, selectEffectiveTurn, selectMatchFinished, selectBetweenGames],
  (canInteract, activePlayer, matchFinished, betweenGames) => ({
    canInteract: canInteract && !matchFinished && !betweenGames,
    isLocalTurn: canInteract,
    activePlayer,
    isFinished: matchFinished,
  }),
)

export const selectCanEndTurn = createSelector([
  selectMatchFinished, selectBetweenGames, selectBoard, selectIsLocalTurn, selectCurrentTurn, selectRemaining, selectLocalLegalMoves,
], (matchFinished, betweenGames, board, isLocalTurn, currentTurn, remaining, legal) => !matchFinished && !betweenGames && !engineWinner(board) && isLocalTurn && currentTurn !== null && (remaining.length === 0 || legal.length === 0))

export const selectCanOfferDouble = createSelector([
  selectMatchFinished, selectBetweenGames, selectInCrawfordGame, selectMatch, selectCurrentTurn, selectCubeOffer, selectIsLocalTurn, selectCubeValue, selectCubeOwner, selectLocalColor,
], (matchFinished, betweenGames, inCrawfordGame, match, currentTurn, cubeOffer, isLocalTurn, cubeValue, cubeOwner, localColor) => !matchFinished && !betweenGames && !inCrawfordGame && !!match && !!match.opponent_id && currentTurn === null && cubeOffer === null && isLocalTurn && cubeValue < 64 && (cubeOwner === null || cubeOwner === localColor))

// These return absolute epoch-ms instants; the wall-clock comparison belongs to
// the listener that wakes and to the component that renders the countdown.
const selectSession = (state: OnlineMatchRootShape) => state.onlineMatch
const selectRouteMatchId = (_state: OnlineMatchRootShape, matchId: string | undefined) => matchId

// Both activity clocks share a mount-time floor so a freshly loaded page cannot
// evaluate a timer against a stale database row (today's `mountedAt`).
export const selectLocalClockBaseMs = createSelector([
  selectSession, selectRouteMatchId,
], (session, matchId): number | null => matchId === undefined ? null : Math.max(session.lastLocalActivityMs ?? 0, session.sessionStartedMs))

export const selectOpponentClockBaseMs = createSelector([
  selectSession, selectRouteMatchId,
], (session, matchId): number | null => matchId === undefined ? null : Math.max(session.lastOpponentActivityMs ?? 0, session.sessionStartedMs))

// Display-only twin: the countdown bar renders on both panels and was never
// gated on whose turn it is. The gated version drives the auto-action.
export const selectTurnDisplayDeadlineMs = createSelector([
  (state: OnlineMatchRootShape) => state.onlineMatch.turnSeconds, selectLocalClockBaseMs,
], (turnSeconds, localClockBase): number | null => turnSeconds === null || localClockBase === null ? null : localClockBase + turnSeconds * 1000)

export const selectTurnDeadlineMs = createSelector([
  (state: OnlineMatchRootShape) => state.onlineMatch.turnSeconds, selectLocalClockBaseMs, selectMatchFinished, selectBetweenGames, selectIsLocalTurn,
], (turnSeconds, localClockBase, matchFinished, betweenGames, isLocalTurn): number | null => {
  if (turnSeconds === null) return null
  if (matchFinished || betweenGames || !isLocalTurn) return null
  if (localClockBase === null) return null
  return localClockBase + turnSeconds * 1000
})

export const selectInactivityDeadlineMs = createSelector([
  selectOpponentClockBaseMs, (state: OnlineMatchRootShape) => state.onlineMatch.inactivityForfeitMs,
], (opponentClockBase, inactivityForfeitMs): number | null => opponentClockBase === null ? null : opponentClockBase + inactivityForfeitMs)

export const selectPresenceForfeitDeadlineMs = createSelector([
  (state: OnlineMatchRootShape) => state.onlineMatch.opponentDisconnectedAt, selectRouteMatchId,
], (opponentDisconnectedAt, matchId): number | null => {
  if (matchId === undefined) return null
  // Whether the grace has expired is the listener's Date.now() comparison.
  if (opponentDisconnectedAt === null) return null
  return opponentDisconnectedAt + PRESENCE_FORFEIT_GRACE_MS
})

// The hook's !isLocalTurn and presence-vs-time branches decided WHEN the claim
// became available; that decision now lives in the listener that wakes at the
// deadline and dispatches opponentInactivityDeadlineReached. Do not re-gate.
export const selectCanClaimByInactivity = createSelector([
  selectMatchFinished, selectMatch, (state: OnlineMatchRootShape) => state.onlineMatch.inactivityClaimAvailable,
], (matchFinished, match, inactivityClaimAvailable): boolean => !matchFinished && !!match?.opponent_id && inactivityClaimAvailable)

export const selectOpponentColor = createSelector([
  selectLocalColor,
], (localColor): Player | null => localColor === "white" ? "black" : localColor === "black" ? "white" : null)

export const selectSelfPipCount = createSelector([
  selectBoard, selectLocalColor,
], (board, localColor): number => localColor === null ? 0 : pipCount(board, localColor))

export const selectOpponentPipCount = createSelector([
  selectBoard, selectOpponentColor,
], (board, opponentColor): number => opponentColor === null ? 0 : pipCount(board, opponentColor))

export const selectMatchTarget = createSelector([
  selectMatch,
], (match): number => match?.target ?? 1)

export const selectSelfScore = createSelector([
  selectMatch, selectLocalColor,
], (match, localColor): number => {
  if (!match || localColor === null) return 0
  return localColor === "white" ? match.white_score : match.black_score
})

export const selectOpponentScore = createSelector([
  selectMatch, selectOpponentColor,
], (match, opponentColor): number => {
  if (!match || opponentColor === null) return 0
  return opponentColor === "white" ? match.white_score : match.black_score
})

export const selectSelfIsTurn = createSelector([
  selectIsLocalTurn, selectMatchFinished, selectBetweenGames,
], (isLocalTurn, matchFinished, betweenGames): boolean => isLocalTurn && !matchFinished && !betweenGames)

export const selectOpponentIsTurn = createSelector([
  selectIsLocalTurn, selectMatchFinished, selectBetweenGames,
], (isLocalTurn, matchFinished, betweenGames): boolean => !isLocalTurn && !matchFinished && !betweenGames)

export const selectCubeDecisionVisible = createSelector([
  selectCubeOffer, selectLocalColor, selectMatchFinished,
], (cubeOffer, localColor, matchFinished): boolean => cubeOffer !== null && localColor !== null && cubeOffer !== localColor && !matchFinished)

const selectTurnTimerActive = createSelector([
  selectTimerViewModel, selectMatchFinished, selectBetweenGames, selectCubeDecisionVisible,
], (timer, matchFinished, betweenGames, cubeDecisionVisible): boolean => timer.deadlineMs !== null && !matchFinished && !betweenGames && !cubeDecisionVisible)

export const selectSelfTimer = createSelector([
  selectSelfIsTurn, selectTimerViewModel, selectTurnTimerActive,
], (isTurn, timer, timerActive): {readonly deadlineMs: number, readonly durationMs: number} | null => isTurn && timerActive && timer.deadlineMs !== null && timer.durationMs !== null ? {deadlineMs: timer.deadlineMs, durationMs: timer.durationMs} : null)

export const selectOpponentTimer = createSelector([
  selectOpponentIsTurn, selectTimerViewModel, selectTurnTimerActive,
], (isTurn, timer, timerActive): {readonly deadlineMs: number, readonly durationMs: number} | null => isTurn && timerActive && timer.deadlineMs !== null && timer.durationMs !== null ? {deadlineMs: timer.deadlineMs, durationMs: timer.durationMs} : null)

export const selectOpponentLevel = createSelector([
  selectMatch, selectRouteMatchId,
], (match, matchId): number => {
  if (!match?.is_bot) return 23
  const difficulty: AILevel = match.bot_level === "easy" || match.bot_level === "hard" ? match.bot_level : "medium"
  return generateAIPersona(matchId ?? null, difficulty).level
})

export const selectOpponentStateLabel = createSelector([
  selectMatch,
], (match): string => {
  if (!match?.is_bot) return "Guest"
  const difficulty: AILevel = match.bot_level === "easy" || match.bot_level === "hard" ? match.bot_level : "medium"
  return aiRankLabel(difficulty)
})

export const selectRemoteOpponentId = createSelector([
  selectMatch, (state: OnlineMatchRootShape) => state.auth.userId,
], (match, userId): string | null => {
  if (!match || !userId) return null
  if (userId === match.owner_id) return match.opponent_id
  if (userId === match.opponent_id) return match.owner_id
  return null
})

// Never match.updated_at: our own automated writes bump it, which would reset
// the opponent's clock forever and we'd never claim against a player who quit.
export const selectOpponentActivitySignature = createSelector([
  selectMoves, selectCurrentTurn, selectLocalColor,
], (moves, currentTurn, localColor): string => {
  const oppositeColor: Player | null = localColor === "white" ? "black" : localColor === "black" ? "white" : null
  if (!oppositeColor) return "no-color"
  const oppMoveCount = moves.reduce((n, m) => (m.player === oppositeColor ? n + 1 : n), 0)
  const oppTurnPart = currentTurn?.player === oppositeColor ? `${currentTurn.dice.join("-")}:${currentTurn.subMoves.length}:${currentTurn.remaining.length}` : ""
  return `${oppMoveCount}|${oppTurnPart}`
})

// Poke at most once per distinct key: a transient ai_move failure must not
// spin a tight invoke loop (a reload resets the key). The bot commits its roll
// + move atomically, so a currentTurn in progress is always the human's.
export const selectBotPokeKey = createSelector([
  selectMatch, selectMatchFinished, selectBetweenGames, selectEffectiveTurn, selectCurrentTurn, selectMoves,
], (match, matchFinished, betweenGames, effectiveTurn, currentTurn, moves): string | null => {
  if (!match?.is_bot) return null
  if (matchFinished || betweenGames) return null
  const botColor: Player = match.owner_color === "white" ? "black" : "white"
  if (effectiveTurn !== botColor) return null
  if (currentTurn) return null
  return `${match.current_game_id ?? ""}:${moves.length}`
})

export type AutoActionKind = "roll" | "force-end"

// force-end deliberately skips canEndTurn: a player sitting on legal moves they
// are not playing gets force-ended too and loses their unplayed dice — the
// intended behavior of a run-out timer.
export const selectAutoActionKind = createSelector([
  selectCanRoll, selectCurrentTurn,
], (canRoll, currentTurn): AutoActionKind | null => canRoll ? "roll" : currentTurn ? "force-end" : null)
