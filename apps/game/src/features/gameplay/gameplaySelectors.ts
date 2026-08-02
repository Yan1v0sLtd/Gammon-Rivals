import {createSelector} from '@reduxjs/toolkit';
import {legalMoves} from '../../../../../packages/engine/src/rules';
import type {GameResult, MatchState} from '../../../../../packages/engine/src/match';
import {canOfferDouble, isCrawfordGame} from '../../../../../packages/engine/src/match';
import type {BoardState, Die, Move, Player, Position} from '../../../../../packages/engine/src/types';
import type {AIConfig, GameplayState, TurnRecord} from './gameplaySlice';
import {createEmptyArray} from '../../lib/constants';

export interface GameplayRootShape {
  readonly gameplay: GameplayState;
}

const selectGameplay = (state: GameplayRootShape) => state.gameplay;

// Canonical state fields (direct reads, memoized per slice reference).
export const selectMatch = createSelector([selectGameplay], (g) => g.match);
export const selectMatchId = createSelector([selectGameplay], (g) => g.matchId);
export const selectBoard = createSelector([selectGameplay], (g) => g.board);
export const selectRoll = createSelector([selectGameplay], (g) => g.roll);
export const selectRemaining = createSelector([selectGameplay], (g) => g.remaining);
export const selectSelectedFrom = createSelector([selectGameplay], (g) => g.selectedFrom);
export const selectTurnLog = createSelector([selectGameplay], (g) => g.turnLog);
export const selectLastGameResult = createSelector([selectGameplay], (g) => g.lastGameResult);
export const selectAiConfig = createSelector([selectGameplay], (g) => g.ai);
export const selectIsAIThinking = createSelector([selectGameplay], (g) => g.isAIThinking);
export const selectAiPreviewReady = createSelector([selectGameplay], (g) => g.aiPreviewReady);
export const selectTurnDeadlineMs = createSelector([selectGameplay], (g) => g.turnDeadlineMs);
export const selectTurnSeconds = createSelector([selectGameplay], (g) => g.turnSeconds);

export const selectMatchOver = createSelector([selectMatch], (match: MatchState) => match.winner !== null,);

export const selectGameFrozen = createSelector([selectLastGameResult, selectMatchOver], (lastGameResult: GameResult | null, matchOver: boolean) => lastGameResult !== null || matchOver,);

// Before the first roll of a game nobody has moved, so board.turn IS the
// opener; once the first turn is logged, turnLog[0].player is the opener and
// stays correct after the board's turn flips.
export const selectOpeningPlayer = createSelector([selectTurnLog, selectBoard], (turnLog: readonly TurnRecord[], board: BoardState): Player => turnLog.length > 0 ? turnLog[0].player : board.turn,);

export const selectInCrawfordGame = createSelector([selectMatch], (match: MatchState) => isCrawfordGame(match),);

export const selectPendingOffer = createSelector([selectMatch], (match: MatchState) => match.cubeOffer,);

export const selectLegalMoves = createSelector([selectBoard, selectRemaining, selectGameFrozen], (board: BoardState, remaining: readonly Die[], frozen: boolean) => {
  if (remaining.length === 0 || frozen) return createEmptyArray<Move>();
  return legalMoves(board, remaining);
},);

export const selectLegalOrigins = createSelector([selectLegalMoves], (legal: readonly Move[]) => {
  if (legal.length === 0) return createEmptyArray<Position>();
  const set = new Set<Position>();
  for (const m of legal) set.add(m.from);
  return Array.from(set);
},);

export const selectValidDestinations = createSelector([selectLegalMoves, selectSelectedFrom], (legal: readonly Move[], selectedFrom: Position | null) => {
  if (selectedFrom === null || legal.length === 0) return createEmptyArray<Position>();
  return legal.filter((m) => m.from === selectedFrom).map((m) => m.to);
},);

export const selectIsAITurn = createSelector([selectAiConfig, selectBoard, selectGameFrozen], (ai: AIConfig | null, board: BoardState, frozen: boolean) => ai !== null && board.turn === ai.player && !frozen,);

export const selectHumanCanInteract = createSelector([selectIsAITurn, selectIsAIThinking], (isAITurn: boolean, isAIThinking: boolean) => !isAITurn && !isAIThinking,);

export const selectOpponentPreviewOrigins = createSelector([selectIsAITurn, selectAiPreviewReady, selectLegalOrigins], (isAITurn: boolean, previewReady: boolean, legalOrigins: readonly Position[]) => isAITurn && previewReady ? legalOrigins : createEmptyArray<Position>(),);

export const selectOpponentPreviewDestinations = createSelector([selectIsAITurn, selectAiPreviewReady, selectLegalMoves], (isAITurn: boolean, previewReady: boolean, legal: readonly Move[]) => {
  if (!isAITurn || !previewReady || legal.length === 0) return createEmptyArray<Position>();
  const set = new Set<Position>();
  for (const m of legal) set.add(m.to);
  return Array.from(set);
},);

export const selectCanEndTurn = createSelector([selectRoll, selectGameFrozen, selectRemaining, selectLegalMoves], (roll, frozen: boolean, remaining: readonly Die[], legal: readonly Move[]) => roll !== null && !frozen && (remaining.length === 0 || legal.length === 0),);

// Reproduces HotSeat's `playerCanRoll` (`roll === null && !lastGameResult &&
// !matchOver && humanCanInteract`): selectGameFrozen already folds the two
// game-end checks, so this is an exact equivalent. Deliberately no
// `match.cubeOffer === null` term — that would change what the Roll button
// shows during an AI cube decision.
export const selectCanRoll = createSelector([selectRoll, selectGameFrozen, selectHumanCanInteract], (roll, frozen: boolean, humanCanInteract: boolean) => roll === null && !frozen && humanCanInteract,);

export const selectCanOfferDouble = createSelector([selectRoll, selectGameFrozen, selectIsAITurn, selectMatch, selectBoard], (roll, frozen: boolean, isAITurn: boolean, match: MatchState, board: BoardState) => roll === null && !frozen && !isAITurn && match.cubeOffer === null && canOfferDouble(match, board.turn),);

export const selectCanUndo = createSelector([selectGameplay, selectGameFrozen, selectIsAITurn], (g: GameplayState, frozen: boolean, isAITurn: boolean) => g.undoSnapshot !== null && !frozen && !isAITurn,);
