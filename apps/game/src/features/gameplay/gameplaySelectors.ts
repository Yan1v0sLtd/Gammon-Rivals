import {createSelector} from "@reduxjs/toolkit"

import {pipCount} from "../../../../../packages/engine/src/board"
import type {GameResult, MatchState} from "../../../../../packages/engine/src/match"
import {canOfferDouble, isCrawfordGame} from "../../../../../packages/engine/src/match"
import {legalMoves} from "../../../../../packages/engine/src/rules"
import type {BoardState, Die, Move, Player, Position} from "../../../../../packages/engine/src/types"
import {generateAIPersona} from "../../lib/aiPersona"
import {createEmptyArray} from "../../lib/constants"
import {aiIdentityFromSeed, aiRankLabel} from "../../lib/identity"
import type {PlayerIdentity} from "../../lib/identity"

import type {AIConfig, GameplayState, TurnRecord} from "./gameplaySlice"

export type GameplayRootShape = {
  readonly gameplay: GameplayState,
}

const selectGameplay = (state: GameplayRootShape) => state.gameplay

// Canonical state fields (direct reads, memoized per slice reference).
export const selectMatch = createSelector([
  selectGameplay,
], (g) => g.match)
export const selectMatchId = createSelector([
  selectGameplay,
], (g) => g.matchId)
export const selectBoard = createSelector([
  selectGameplay,
], (g) => g.board)
export const selectBoardTurn = createSelector([
  selectGameplay,
], (g) => g.board.turn)
export const selectRoll = createSelector([
  selectGameplay,
], (g) => g.roll)
export const selectRemaining = createSelector([
  selectGameplay,
], (g) => g.remaining)
export const selectSelectedFrom = createSelector([
  selectGameplay,
], (g) => g.selectedFrom)
export const selectTurnLog = createSelector([
  selectGameplay,
], (g) => g.turnLog)
export const selectLastGameResult = createSelector([
  selectGameplay,
], (g) => g.lastGameResult)
export const selectAiConfig = createSelector([
  selectGameplay,
], (g) => g.ai)
export const selectIsAIThinking = createSelector([
  selectGameplay,
], (g) => g.isAIThinking)
export const selectAiPreviewReady = createSelector([
  selectGameplay,
], (g) => g.aiPreviewReady)
export const selectTurnDeadlineMs = createSelector([
  selectGameplay,
], (g) => g.turnDeadlineMs)
export const selectTurnSeconds = createSelector([
  selectGameplay,
], (g) => g.turnSeconds)
export const selectTurnTimerEnabled = createSelector([
  selectGameplay,
], (g) => g.turnTimerEnabled)

export type GameplayTimerViewModel = {
  readonly deadlineMs: number | null,
  readonly durationMs: number,
  readonly activePlayer: Player,
}

export const selectTimerViewModel = createSelector(
  [selectTurnDeadlineMs, selectTurnSeconds, selectTurnTimerEnabled, selectBoardTurn],
  (deadlineMs, turnSeconds, enabled, activePlayer): GameplayTimerViewModel => ({
    deadlineMs: enabled ? deadlineMs : null,
    durationMs: turnSeconds * 1000,
    activePlayer,
  }),
)

export const selectMatchOver = createSelector([
  selectMatch,
], (match: MatchState) => match.winner !== null)

export const selectGameFrozen = createSelector([
  selectLastGameResult, selectMatchOver,
], (lastGameResult: GameResult | null, matchOver: boolean) => lastGameResult !== null || matchOver)

// Before the first roll of a game nobody has moved, so board.turn IS the
// opener; once the first turn is logged, turnLog[0].player is the opener and
// stays correct after the board's turn flips.
export const selectOpeningPlayer = createSelector([
  selectTurnLog, selectBoardTurn,
], (turnLog: readonly TurnRecord[], boardTurn: Player): Player => turnLog.length > 0 ? turnLog[0].player : boardTurn)

export const selectInCrawfordGame = createSelector([
  selectMatch,
], (match: MatchState) => isCrawfordGame(match))

export const selectPendingOffer = createSelector([
  selectMatch,
], (match: MatchState) => match.cubeOffer)

export const selectLegalMoves = createSelector([
  selectBoard, selectRemaining, selectGameFrozen,
], (board: BoardState, remaining: readonly Die[], frozen: boolean) => {
  if (remaining.length === 0 || frozen) return createEmptyArray<Move>()
  return legalMoves(board, remaining)
})

export const selectLegalOrigins = createSelector([
  selectLegalMoves,
], (legal: readonly Move[]) => {
  if (legal.length === 0) return createEmptyArray<Position>()
  const set = new Set<Position>()
  for (const m of legal) set.add(m.from)
  return Array.from(set)
})

export const selectValidDestinations = createSelector([
  selectLegalMoves, selectSelectedFrom,
], (legal: readonly Move[], selectedFrom: Position | null) => {
  if (selectedFrom === null || legal.length === 0) return createEmptyArray<Position>()
  return legal.filter((m) => m.from === selectedFrom).map((m) => m.to)
})

export const selectBoardPositionViewModel = createSelector(
  [selectBoard, selectRoll, selectRemaining],
  (board, roll, remaining) => ({board, roll, remaining}),
)

export const selectIsAITurn = createSelector([
  selectAiConfig, selectBoardTurn, selectGameFrozen,
], (ai: AIConfig | null, boardTurn: Player, frozen: boolean) => ai !== null && boardTurn === ai.player && !frozen)

export const selectHumanCanInteract = createSelector([
  selectIsAITurn, selectIsAIThinking,
], (isAITurn: boolean, isAIThinking: boolean) => !isAITurn && !isAIThinking)

export const selectInteractionViewModel = createSelector(
  [selectHumanCanInteract, selectIsAITurn, selectBoardTurn, selectGameFrozen],
  (canInteract, isAITurn, activePlayer, frozen) => ({
    canInteract,
    isAITurn,
    activePlayer,
    isFrozen: frozen,
  }),
)

export const selectOpponentPreviewOrigins = createSelector([
  selectIsAITurn, selectAiPreviewReady, selectLegalOrigins,
], (isAITurn: boolean, previewReady: boolean, legalOrigins: readonly Position[]) => isAITurn && previewReady ? legalOrigins : createEmptyArray<Position>())

export const selectOpponentPreviewDestinations = createSelector([
  selectIsAITurn, selectAiPreviewReady, selectLegalMoves,
], (isAITurn: boolean, previewReady: boolean, legal: readonly Move[]) => {
  if (!isAITurn || !previewReady || legal.length === 0) return createEmptyArray<Position>()
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

export const selectCanEndTurn = createSelector([
  selectRoll, selectGameFrozen, selectRemaining, selectLegalMoves,
], (roll, frozen: boolean, remaining: readonly Die[], legal: readonly Move[]) => roll !== null && !frozen && (remaining.length === 0 || legal.length === 0))

// Reproduces HotSeat's `playerCanRoll` (`roll === null && !lastGameResult &&
// !matchOver && humanCanInteract`): selectGameFrozen already folds the two
// game-end checks, so this is an exact equivalent. Deliberately no
// `match.cubeOffer === null` term — that would change what the Roll button
// shows during an AI cube decision.
export const selectCanRoll = createSelector([
  selectRoll, selectGameFrozen, selectHumanCanInteract,
], (roll, frozen: boolean, humanCanInteract: boolean) => roll === null && !frozen && humanCanInteract)

export const selectCanOfferDouble = createSelector([
  selectRoll, selectGameFrozen, selectIsAITurn, selectMatch, selectBoard,
], (roll, frozen: boolean, isAITurn: boolean, match: MatchState, board: BoardState) => roll === null && !frozen && !isAITurn && match.cubeOffer === null && canOfferDouble(match, board.turn))

export const selectCanUndo = createSelector([
  selectGameplay, selectGameFrozen, selectIsAITurn,
], (g: GameplayState, frozen: boolean, isAITurn: boolean) => g.undoSnapshot !== null && !frozen && !isAITurn)

export const selectLocalColor = createSelector([
  selectAiConfig,
], (ai): Player => ai ? (ai.player === "black" ? "white" : "black") : "white")

export const selectOpponentColor = createSelector([
  selectLocalColor,
], (localColor): Player => localColor === "white" ? "black" : "white")

export const selectSelfPipCount = createSelector([
  selectBoard, selectLocalColor,
], (board, localColor) => pipCount(board, localColor))

export const selectOpponentPipCount = createSelector([
  selectBoard, selectOpponentColor,
], (board, opponentColor) => pipCount(board, opponentColor))

export const selectMatchTarget = createSelector([
  selectMatch,
], (match) => match.target)

export const selectSelfScore = createSelector([
  selectMatch, selectLocalColor,
], (match, localColor) => match.score[localColor])

export const selectOpponentScore = createSelector([
  selectMatch, selectOpponentColor,
], (match, opponentColor) => match.score[opponentColor])

export const selectCubeValue = createSelector([
  selectMatch,
], (match) => match.cube.value)

const selectIsLocalTurn = createSelector([
  selectBoardTurn, selectLocalColor, selectIsAITurn,
], (boardTurn, localColor, isAITurn) => boardTurn === localColor && !isAITurn)

export const selectSelfIsTurn = createSelector([
  selectIsLocalTurn, selectLastGameResult,
], (isLocalTurn, lastGameResult) => isLocalTurn && lastGameResult === null)

export const selectOpponentIsTurn = createSelector([
  selectIsLocalTurn, selectLastGameResult,
], (isLocalTurn, lastGameResult) => !isLocalTurn && lastGameResult === null)

export const selectCubeDecisionVisible = createSelector(
  [selectPendingOffer, selectLastGameResult, selectAiConfig],
  (pendingOffer, lastGameResult, aiConfig) => pendingOffer !== null && !lastGameResult && !(aiConfig && pendingOffer !== aiConfig.player),
)

const selectTurnTimerActive = createSelector(
  [selectTimerViewModel, selectLastGameResult, selectCubeDecisionVisible, selectMatchOver],
  (timer, lastGameResult, cubeDecisionVisible, matchOver) => timer.deadlineMs !== null && lastGameResult === null && !cubeDecisionVisible && !matchOver,
)

export const selectSelfTimer = createSelector(
  [selectSelfIsTurn, selectTimerViewModel, selectTurnTimerActive],
  (isTurn, timer, timerActive) => isTurn && timerActive ? {deadlineMs: timer.deadlineMs, durationMs: timer.durationMs} : null,
)

export const selectOpponentTimer = createSelector(
  [selectOpponentIsTurn, selectTimerViewModel, selectTurnTimerActive],
  (isTurn, timer, timerActive) => isTurn && timerActive ? {deadlineMs: timer.deadlineMs, durationMs: timer.durationMs} : null,
)

export const selectOpponentLevel = createSelector([
  selectMatchId, selectAiConfig,
], (matchId, aiConfig) => aiConfig ? generateAIPersona(matchId, aiConfig.level).level : 23)

export const selectOpponentIdentity = createSelector([
  selectMatchId,
], (matchId): PlayerIdentity => aiIdentityFromSeed(matchId ?? ""))

export const selectOpponentStateLabel = createSelector([
  selectAiConfig,
], (aiConfig) => aiConfig ? aiRankLabel(aiConfig.level) : "Guest")
