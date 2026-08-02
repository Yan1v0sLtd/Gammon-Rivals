import {isAnyOf, TaskAbortError} from '@reduxjs/toolkit';
import {captureException} from '@sentry/react';
import {pickMoveAsync} from '../../../../../packages/ai/src/client';
import {applyMove, winner as engineWinner} from '../../../../../packages/engine/src/rules';
import type {BoardState, Move} from '../../../../../packages/engine/src/types';
import type {AppStartListening} from '../../store/listenerTypes';
import {authSessionResolved, authSignedOut} from '../auth/authSlice';
import {playerDataApi} from '../playerData/playerDataApi';
import {gameplayApi, gameplayFinishCacheKey} from './gameplayApi';
import {type FinishMatchArgs, modeFromAi, type SaveGameArgs} from './gameplayData';
import {
  AI_CUBE_DECISION_DELAY,
  AI_DICE_SETTLE_MS,
  AI_END_TURN_DELAY,
  AI_PER_MOVE_DELAY,
  AI_ROLL_DELAY,
  aiPreviewReadyChanged,
  aiThinkingChanged,
  AUTO_ROLL_DELAY,
  checkerMoved,
  diceRolled,
  doubleAccepted,
  doubleDropped,
  doubleOffered,
  gameContinued,
  gameplayRouteEntered,
  gameplayRouteExited,
  matchIdAssigned,
  turnDeadlineChanged,
  turnEnded,
  turnForfeited,
} from './gameplaySlice';
import {autoRollEligibilityChanged} from './gameplayActions';
import {selectGameFrozen, selectIsAITurn} from './gameplaySelectors';

type PendingGame = Omit<SaveGameArgs, 'matchId'>;
type PendingFinish = Omit<FinishMatchArgs, 'matchId'>;

interface PersistenceSession {
  readonly id: string;
  active: boolean;
  ownerUserId: string | null;
  readonly finishWithRewards: boolean;
  createPromise: Promise<string | null> | null;
  createdMatchId: string | null;
  readonly pendingGames: Map<number, PendingGame>;
  readonly startedGames: Set<number>;
  pendingFinish: PendingFinish | null;
  finishStarted: boolean;
  finishMutation: { reset(): void } | null;
}

function createPersistenceSession(id: string, ownerUserId: string | null, matchId: string | null, finishWithRewards: boolean,): PersistenceSession {
  return {
    id,
    active: true,
    ownerUserId,
    finishWithRewards,
    createPromise: null,
    createdMatchId: matchId,
    pendingGames: new Map(),
    startedGames: new Set(),
    pendingFinish: null,
    finishStarted: false,
    finishMutation: null,
  };
}

/**
 * Events that can hand the turn to the AI or otherwise need the AI workflow
 * to re-evaluate: a fresh session/game/match, an AI roll completing, a turn
 * handoff, or a human cube offer against the AI. `checkerMoved` is excluded
 * deliberately — the AI's own per-move dispatches must not supersede the
 * running sequence (they never hand the turn to the AI; `turnEnded` does).
 */
const gameplayWorkflowMatcher = isAnyOf(gameplayRouteEntered, gameplayRouteExited, diceRolled, turnEnded, turnForfeited, doubleOffered, gameContinued);

export function startGameplayListeners(startListening: AppStartListening): void {
  startListening({
    matcher: gameplayWorkflowMatcher,
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getOriginalState,
      getState,
      signal
    },) => {
      // Route exit is the cancellation event for the whole AI workflow: kill
      // any in-flight task — the slice already reset the session, and a stale
      // task must not dispatch into the next session. Every other trigger
      // supersedes a running task so only the newest workflow survives.
      if (gameplayRouteExited.match(action)) {
        cancelActiveListeners();
        return;
      }

      // Every action in this matcher is a gameplay-slice action, so a rejected
      // one (a roll while dice are already out, an end-turn the guard refused)
      // leaves the same slice reference. Bail before cancelling: such an action
      // changed nothing for the AI to react to, and superseding the running
      // task would abort live choreography — the same reasoning as the turn
      // timer's no-op check below.
      if (getOriginalState().gameplay === getState().gameplay) return;

      cancelActiveListeners();

      const s = getState().gameplay;
      const ai = s.ai;
      if (ai === null) return;
      if (selectGameFrozen(getState())) return;

      // Cube offer pending against the AI: respond after a think delay.
      // v1: AI always accepts. Cube AI is a future improvement.
      if (s.match.cubeOffer !== null && s.match.cubeOffer !== ai.player) {
        dispatch(aiThinkingChanged({thinking: true}));
        try {
          await delay(AI_CUBE_DECISION_DELAY);
          dispatch(doubleAccepted());
        }
        catch (err) {
          // Cancellation is not a failure; a real error must not freeze the
          // match on a pending offer.
          if (err instanceof TaskAbortError || signal.aborted) return;
          captureException(err);
          console.error('[gameplay] AI cube response failed', err);
        }
        finally {
          // Always release the thinking flag — if it stays set the board
          // reads "AI thinking" forever with nobody acting on it.
          if (!signal.aborted) dispatch(aiThinkingChanged({thinking: false}));
        }
        return;
      }

      if (s.board.turn !== ai.player) return;

      // Roll if not rolled
      if (s.roll === null) {
        try {
          await delay(AI_ROLL_DELAY);
          dispatch(diceRolled());
        }
        catch (err) {
          if (err instanceof TaskAbortError || signal.aborted) return;
          captureException(err);
          console.error('[gameplay] AI roll failed', err);
        }
        return;
      }

      // Plan + play (only when no moves played yet this turn).
      // pickMoveAsync runs in parallel with the dice-settle wait so the AI's
      // thinking time doesn't add on top of the dice animation.
      if (s.history.length === 0 && s.remaining.length > 0) {
        const aiPlayer = ai.player;

        // Apply a planned sequence of moves with delays for visual feedback.
        // Maintains a local board copy so the choreography (win detection,
        // early end) doesn't depend on re-renders; canonical updates go
        // through the slice.
        const playAISequence = async (initialBoard: BoardState, initialMoves: readonly Move[],): Promise<void> => {
          let curBoard = initialBoard;
          for (const move of initialMoves) {
            await delay(AI_PER_MOVE_DELAY);
            if (signal.aborted) return;
            dispatch(aiPreviewReadyChanged({ready: false}));
            curBoard = applyMove(curBoard, move);
            // Send the exact die from the plan so ambiguous bear-off moves
            // keep the correct identity in the reducer and turn log.
            dispatch(checkerMoved({
              from: move.from,
              to: move.to,
              die: move.die
            }));

            if (engineWinner(curBoard)) return; // game over — no end-turn
          }

          await delay(AI_END_TURN_DELAY);
          if (signal.aborted) return;
          dispatch(turnEnded({force: true}));
        };

        dispatch(aiThinkingChanged({thinking: true}));
        try {
          const planPromise = pickMoveAsync(s.board, s.remaining, ai.level);
          await delay(AI_DICE_SETTLE_MS);
          if (signal.aborted) return;
          dispatch(aiPreviewReadyChanged({ready: true}));
          const plan = await planPromise;
          if (signal.aborted) return;
          dispatch(aiThinkingChanged({thinking: false}));

          if (plan.length === 0) {
            await delay(AI_END_TURN_DELAY);
            if (signal.aborted) return;
            dispatch(aiPreviewReadyChanged({ready: false}));
            dispatch(turnEnded({force: true}));
          }
          else {
            await playAISequence(s.board, plan);
          }
        }
        catch (err) {
          // A failure here (planner crash, or applyMove rejecting a plan
          // that raced a board update) used to reject unhandled, leaving the
          // match frozen on "AI thinking". Recover by forfeiting the rest of
          // the AI's turn — only while it is still the AI's turn and the game
          // has no winner.
          if (err instanceof TaskAbortError || signal.aborted) return;
          captureException(err);
          console.error('[gameplay] AI turn failed — ending AI turn to keep the match playable', err);
          dispatch(aiPreviewReadyChanged({ready: false}));
          const live = getState().gameplay;
          if (live.board.turn !== aiPlayer) return;
          if (selectGameFrozen(getState())) return;
          // turnForfeited re-enters this workflow listener and aborts the
          // current task, so the finally below skips its thinking reset
          // (signal.aborted). Release the flag here, or the next human turn
          // stays locked on "AI thinking".
          dispatch(aiThinkingChanged({thinking: false}));
          dispatch(turnForfeited({expectedPlayer: aiPlayer}));
        }
        finally {
          // Never leave isAIThinking stuck true. A cancelled task's state was
          // already reset by the action that aborted it.
          if (!signal.aborted) dispatch(aiThinkingChanged({thinking: false}));
        }
      }
    },
  });

  const turnTimerMatcher = isAnyOf(gameplayRouteEntered, gameplayRouteExited, turnEnded, turnForfeited, doubleOffered, doubleAccepted, doubleDropped, gameContinued, checkerMoved);

  startListening({
    matcher: turnTimerMatcher,
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getOriginalState,
      getState,
      signal
    },) => {
      if (gameplayRouteExited.match(action)) {
        cancelActiveListeners();
        return;
      }

      const previous = getOriginalState().gameplay;
      const current = getState().gameplay;

      // A rejected end/offer/move action leaves the same slice reference. Do
      // not restart a live deadline for an action that changed nothing.
      if (previous === current) return;

      // A normal checker move does not restart the turn timer. It only enters
      // this listener so a bear-off result can cancel the old deadline.
      if (checkerMoved.match(action) && !selectGameFrozen(getState())) return;

      cancelActiveListeners();

      if (!current.turnTimerEnabled || selectGameFrozen(getState()) || current.match.cubeOffer !== null) {
        dispatch(turnDeadlineChanged({deadlineMs: null}));
        return;
      }

      // The AI still gets a visible countdown, but only human turns may be
      // forfeited. This preserves the old humanCanInteract guard in HotSeat.
      const deadlineMs = Date.now() + current.turnSeconds * 1000;
      dispatch(turnDeadlineChanged({deadlineMs}));

      try {
        await delay(Math.max(0, deadlineMs - Date.now()));
        if (signal.aborted) return;

        const live = getState().gameplay;
        if (live.turnDeadlineMs !== deadlineMs) return;
        if (!live.turnTimerEnabled || selectGameFrozen(getState())) return;
        if (live.match.cubeOffer !== null || selectIsAITurn(getState())) return;

        // This action is itself a timer-workflow event, so listener
        // cancellation replaces the component's timeoutHandledRef latch.
        dispatch(turnForfeited());
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        captureException(err);
        console.error('[gameplay] turn timer failed', err);
      }
    },
  });

  const autoRollMatcher = isAnyOf(gameplayRouteEntered, gameplayRouteExited, diceRolled, turnEnded, turnForfeited, doubleOffered, doubleAccepted, doubleDropped, gameContinued, checkerMoved, autoRollEligibilityChanged);

  // This is workflow input, not application state: the preference remains in
  // useAutoRoll and the reveal flag remains derived by HotSeat. The closure is
  // per store, so it cannot leak between store instances or route sessions.
  let autoRollEnabled = false;

  startListening({
    matcher: autoRollMatcher,
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState,
      signal
    }) => {
      if (autoRollEligibilityChanged.match(action)) {
        autoRollEnabled = action.payload.enabled;
      }

      if (gameplayRouteExited.match(action)) {
        autoRollEnabled = false;
        cancelActiveListeners();
        return;
      }

      cancelActiveListeners();
      const current = getState().gameplay;
      if (!autoRollEnabled || current.roll !== null) return;
      if (selectGameFrozen(getState()) || current.match.cubeOffer !== null) return;
      if (selectIsAITurn(getState()) || current.isAIThinking) return;

      try {
        // Match the old dice choreography: let the turn transition render
        // before the automatic throw, and cancel if the user acts first.
        await delay(AUTO_ROLL_DELAY);
        if (signal.aborted || !autoRollEnabled) return;

        const live = getState().gameplay;
        if (live.roll !== null || live.match.cubeOffer !== null) return;
        if (selectGameFrozen(getState()) || selectIsAITurn(getState()) || live.isAIThinking) return;

        dispatch(diceRolled());
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        captureException(err);
        console.error('[gameplay] auto-roll failed', err);
      }
    },
  });

  // If the difficulty modal pre-created the match via enter_room, skip
  // the local createMatch call entirely — the row already exists, the
  // entry fee was already debited server-side, and we should use that
  // id for all later writes (saveGame, finishMatch).
  const persistenceMatcher = isAnyOf(gameplayRouteEntered, gameplayRouteExited, authSessionResolved, authSignedOut, matchIdAssigned, checkerMoved, doubleDropped,);
  let persistenceSession: PersistenceSession | null = null;

  startListening({
    matcher: persistenceMatcher,
    effect: async (action, {
      cancelActiveListeners,
      dispatch,
      getOriginalState,
      getState,
      signal
    },) => {
      const current = getState().gameplay;

      if (gameplayRouteEntered.match(action)) {
        const sessionId = action.payload.sessionId;
        if (persistenceSession?.id !== sessionId) {
          persistenceSession?.finishMutation?.reset();
          persistenceSession = createPersistenceSession(sessionId, getState().auth.userId, current.matchId, action.payload.presetMatchId !== null,);
        }
        else {
          persistenceSession.active = true;
        }
      }

      if (gameplayRouteExited.match(action)) {
        if (persistenceSession !== null) {
          persistenceSession.active = false;
          persistenceSession.finishMutation?.reset();
          persistenceSession.finishMutation = null;
        }
        cancelActiveListeners();
        return;
      }

      if (authSessionResolved.match(action) && persistenceSession !== null) {
        if (persistenceSession.ownerUserId !== action.payload.userId && current.matchId === null) {
          // Match the old component effect: before an ID exists, a newly
          // resolved identity gets its own create attempt. A completed older
          // request is ignored by the owner/promise guards below.
          persistenceSession.createPromise = null;
          persistenceSession.createdMatchId = null;
        }
        persistenceSession.ownerUserId = action.payload.userId;
      }
      else if (authSignedOut.match(action) && persistenceSession !== null) {
        if (current.matchId === null) {
          persistenceSession.createPromise = null;
          persistenceSession.createdMatchId = null;
        }
        persistenceSession.ownerUserId = null;
      }

      const session = persistenceSession;
      if (session === null || !session.active) return;

      const previous = getOriginalState().gameplay;
      const gameJustFinished = (checkerMoved.match(action) || doubleDropped.match(action)) && current.lastGameResult !== null && current.lastGameResult !== previous.lastGameResult;

      if (gameJustFinished) {
        const gameNumber = current.match.winner ? current.match.gameNumber : current.match.gameNumber - 1;
        if (!session.startedGames.has(gameNumber) && !session.pendingGames.has(gameNumber)) {
          session.pendingGames.set(gameNumber, {
            gameNumber,
            result: current.lastGameResult!,
            cubeOwner: current.match.cube.owner,
            wasCrawford: current.match.crawfordGameNumber === gameNumber,
            moves: current.turnLog.map((turn) => ({
              player: turn.player,
              dice: turn.dice,
              subMoves: turn.subMoves, // null for AI turns and any turn that closed via an edge case
              // (we'd rather omit than back-fill a fabricated value).
              elapsedMs: turn.elapsedMs,
            })),
          });
        }

        if (current.match.winner !== null && !session.finishStarted && !session.pendingFinish) {
          session.pendingFinish = {
            whiteScore: current.match.score.white,
            blackScore: current.match.score.black,
            winner: current.match.winner,
            crawfordGameNumber: current.match.crawfordGameNumber,
          };
        }
      }

      const matchId = current.matchId;
      if (matchId === null && session.createdMatchId !== null) {
        dispatch(matchIdAssigned({matchId: session.createdMatchId}));
        return;
      }

      if (matchId === null) {
        const auth = getState().auth;
        if (auth.status !== 'authenticated' || auth.userId === null) return;

        if (session.createPromise === null) {
          session.ownerUserId = auth.userId;
          session.createPromise = dispatch(gameplayApi.endpoints.createMatch.initiate({
            ownerId: auth.userId,
            mode: modeFromAi(current.ai),
            target: current.match.target,
          }, {track: false},),)
            .unwrap()
            .catch((err) => {
              console.warn('createMatch failed', err);
              return null;
            });
        }

        const createPromise = session.createPromise;
        const createOwnerUserId = session.ownerUserId;
        const createdMatchId = await createPromise;
        if (createdMatchId === null || signal.aborted) return;
        if (persistenceSession !== session || !session.active) return;
        if (session.createPromise !== createPromise) return;
        if (session.ownerUserId !== createOwnerUserId) return;
        if (getState().auth.userId !== createOwnerUserId) return;
        session.createdMatchId = createdMatchId;
        dispatch(matchIdAssigned({matchId: createdMatchId}));
        return;
      }

      session.createdMatchId = matchId;
      for (const [gameNumber, pendingGame] of session.pendingGames) {
        if (session.startedGames.has(gameNumber)) continue;
        session.startedGames.add(gameNumber);
        session.pendingGames.delete(gameNumber);
        void dispatch(gameplayApi.endpoints.saveGame.initiate({
          ...pendingGame,
          matchId
        }, {track: false},),)
          .unwrap()
          .catch((err) => {
            console.warn('saveGame failed', err);
          });
      }

      if (session.pendingFinish === null || session.finishStarted) return;

      const pendingFinish = session.pendingFinish;
      // presetMatchId being set means the match was created by enter_room
      // and (if won) is eligible for XP/coin rewards. Route through the
      // RPC so the server can validate ownership + award atomically.
      // Other matches (legacy ?opp=... / online) keep using the plain
      // UPDATE in finishMatch().
      if (session.finishWithRewards) {
        const userId = getState().auth.userId;
        if (userId === null || userId !== session.ownerUserId) return;
        session.finishStarted = true;
        session.pendingFinish = null;
        const finishMutation = dispatch(gameplayApi.endpoints.finishMatchRpc.initiate({
          ...pendingFinish,
          matchId,
          userId
        }, {fixedCacheKey: gameplayFinishCacheKey(session.id)},),);
        session.finishMutation = finishMutation;
        void finishMutation
          .unwrap()
          .then(() => {
            // Rewards (XP + coins) granted by the server-side finish_match
            // RPC; refresh profile/wallet/XP boost so the lobby's top bar is
            // correct when the user navigates home. Refetch directly instead
            // of relying on RTK Query's delayed tag invalidation, which can
            // sit behind a pending saveGame mutation.
            void dispatch(playerDataApi.endpoints.getProfile.initiate(userId, {
              subscribe: false,
              forceRefetch: true,
            }),);
            void dispatch(playerDataApi.endpoints.getWallet.initiate(userId, {
              subscribe: false,
              forceRefetch: true,
            }),);
            void dispatch(playerDataApi.endpoints.getActiveXpBoost.initiate(userId, {
              subscribe: false,
              forceRefetch: true,
            }),);
          })
          .catch((err) => {
            console.warn('finishMatch RPC failed', err);
          });
        return;
      }

      session.finishStarted = true;
      session.pendingFinish = null;
      void dispatch(gameplayApi.endpoints.finishMatch.initiate({
        ...pendingFinish,
        matchId
      }, {track: false},),)
        .unwrap()
        .catch((err) => {
          console.warn('finishMatch failed', err);
        });
    },
  });
}
