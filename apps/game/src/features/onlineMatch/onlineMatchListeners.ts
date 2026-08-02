import {isAnyOf, TaskAbortError} from '@reduxjs/toolkit';
import type {AppStartListening} from '../../store/listenerTypes';
import {isSupabaseConfigured, supabase} from '../../lib/supabase';
import {authSessionResolved, authSignedOut} from '../auth/authSlice';
import {onlineAutoRollEligibilityChanged} from './onlineMatchActions';
import {finishTurnCacheKey, onlineMatchApi, rollDiceCacheKey,} from './onlineMatchApi';
import {buildFinalizeScores} from './onlineMatchData';
import {classifyConversionError} from './onlineMatchErrors';
import {
  checkerSelected,
  localActivityObserved,
  ONLINE_AUTO_ROLL_DELAY_MS,
  onlineMatchRouteEntered,
  onlineMatchRouteExited,
  opponentActivityObserved,
  opponentInactivityDeadlineReached,
  opponentPresenceChanged,
} from './onlineMatchSlice';
import {
  selectAutoActionKind,
  selectBetweenGames,
  selectBotPokeKey,
  selectCanRoll,
  selectFinishTurnPending,
  selectInactivityDeadlineMs,
  selectIsLocalTurn,
  selectLocalColor,
  selectMatch,
  selectMatchFinished,
  selectOpponentActivitySignature,
  selectPresenceForfeitDeadlineMs,
  selectRollPending,
  selectTurnDeadlineMs,
} from './onlineMatchSelectors';
import type {RootState} from '../../store/store';

const snapshotFulfilled = onlineMatchApi.endpoints.getActiveMatch.matchFulfilled;

/** A local command in flight is itself an interaction, so it resets the turn timer. */
const localCommandStarted = isAnyOf(onlineMatchApi.endpoints.rollDice.matchPending, onlineMatchApi.endpoints.finishTurn.matchPending, onlineMatchApi.endpoints.submitSubMove.matchPending,);

const activityInputs = isAnyOf(snapshotFulfilled, checkerSelected, onlineMatchApi.endpoints.rollDice.matchPending, onlineMatchApi.endpoints.finishTurn.matchPending, onlineMatchApi.endpoints.submitSubMove.matchPending,);

function sessionMatchId(state: RootState): string | undefined {
  return state.onlineMatch.matchId ?? undefined;
}

export function startOnlineMatchListeners(startListening: AppStartListening): void {
  // Supabase fires 'leave' on every other subscriber within ~1s of a clean tab
  // close, so the forfeit path does not wait out the inactivity threshold.
  // Keyed on the user id as well as the match: on a cold load the session is
  // still resolving, and the channel needs the id as its presence key.
  let presenceTeardown: (() => void) | null = null;
  let presenceKey: string | null = null;

  startListening({
    matcher: isAnyOf(onlineMatchRouteEntered, onlineMatchRouteExited, authSessionResolved, authSignedOut,),
    effect: (_action, {
      dispatch,
      getState
    }) => {
      const state = getState();
      const matchId = state.onlineMatch.matchId;
      const userId = state.auth.userId;
      const key = matchId === null || userId === null ? null : `${matchId}:${userId}`;
      if (key === presenceKey) return;

      presenceTeardown?.();
      presenceTeardown = null;
      presenceKey = key;
      if (key === null || matchId === null || userId === null || !isSupabaseConfigured) return;

      const channel = supabase.channel(`match-presence-${matchId}`, {
        config: {presence: {key: userId}},
      });
      const handleSync = () => {
        const online = Object.keys(channel.presenceState()).some((k) => k !== userId);
        dispatch(opponentPresenceChanged({
          online,
          atMs: Date.now()
        }));
      };
      channel
        .on('presence', {event: 'sync'}, handleSync)
        .on('presence', {event: 'join'}, handleSync)
        .on('presence', {event: 'leave'}, handleSync)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void channel.track({user_id: userId});
        });
      presenceTeardown = () => {
        void channel.untrack();
        void supabase.removeChannel(channel);
      };
    },
  });

  // Two independent clocks, as in the hook they replace: local activity drives
  // the soft turn timer, opponent activity drives the inactivity claim.
  startListening({
    matcher: activityInputs,
    effect: (action, {
      dispatch,
      getOriginalState,
      getState
    }) => {
      const state = getState();
      const matchId = sessionMatchId(state);
      if (matchId === undefined) return;
      const before = getOriginalState();
      const now = Date.now();

      // checkerSelected writes nothing to the server, so without this the turn
      // timer would expire on a player who is actively picking a checker.
      if (checkerSelected.match(action) || localCommandStarted(action)) {
        dispatch(localActivityObserved({atMs: now}));
      }

      if (!snapshotFulfilled(action)) return;

      // A turn handed to us starts a fresh turnSeconds window.
      if (selectIsLocalTurn(state, matchId) && !selectIsLocalTurn(before, matchId)) {
        dispatch(localActivityObserved({atMs: now}));
      }

      if (selectOpponentActivitySignature(state, matchId) !== selectOpponentActivitySignature(before, matchId)) {
        dispatch(opponentActivityObserved({atMs: now}));
      }
    },
  });

  // Deadline armed once per turn window; the poll must not restart it, so a
  // trigger that leaves the deadline unchanged returns without cancelling.
  let armedTurnDeadline: number | null = null;

  startListening({
    matcher: isAnyOf(snapshotFulfilled, localActivityObserved, onlineMatchRouteEntered, onlineMatchRouteExited,),
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState,
      signal
    }) => {
      if (onlineMatchRouteExited.match(action) || onlineMatchRouteEntered.match(action)) {
        armedTurnDeadline = null;
        cancelActiveListeners();
        return;
      }

      const matchId = sessionMatchId(getState());
      if (matchId === undefined) return;
      const deadline = selectTurnDeadlineMs(getState(), matchId);
      if (deadline === armedTurnDeadline) return;

      cancelActiveListeners();
      armedTurnDeadline = deadline;
      if (deadline === null) return;

      try {
        await delay(Math.max(0, deadline - Date.now()));
        if (signal.aborted) return;

        const live = getState();
        if (selectTurnDeadlineMs(live, matchId) !== deadline) return;
        const kind = selectAutoActionKind(live, matchId);
        if (kind === null) return;
        // Shared pending state: an auto-action racing a manual click must not
        // produce a second server write.
        if (kind === 'roll') {
          if (selectRollPending(live, matchId)) return;
          await dispatch(onlineMatchApi.endpoints.rollDice.initiate(matchId, {
            fixedCacheKey: rollDiceCacheKey(matchId),
          }),).unwrap();
        }
        else {
          if (selectFinishTurnPending(live, matchId)) return;
          await dispatch(onlineMatchApi.endpoints.finishTurn.initiate(matchId, {
            fixedCacheKey: finishTurnCacheKey(matchId),
          }),).unwrap();
        }
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        console.warn('[onlineMatch] turn auto-action failed', err);
      }
    },
  });

  let autoRollEnabled = false;

  startListening({
    matcher: isAnyOf(snapshotFulfilled, onlineAutoRollEligibilityChanged, onlineMatchRouteEntered, onlineMatchRouteExited,),
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState,
      signal
    }) => {
      if (onlineAutoRollEligibilityChanged.match(action)) {
        autoRollEnabled = action.payload.enabled;
      }
      if (onlineMatchRouteExited.match(action)) {
        autoRollEnabled = false;
        cancelActiveListeners();
        return;
      }
      if (onlineMatchRouteEntered.match(action)) {
        cancelActiveListeners();
        return;
      }

      cancelActiveListeners();
      const matchId = sessionMatchId(getState());
      if (matchId === undefined || !autoRollEnabled) return;
      if (!selectCanRoll(getState(), matchId) || selectBetweenGames(getState(), matchId)) return;

      try {
        await delay(ONLINE_AUTO_ROLL_DELAY_MS);
        if (signal.aborted || !autoRollEnabled) return;

        const live = getState();
        if (!selectCanRoll(live, matchId) || selectBetweenGames(live, matchId)) return;
        if (selectRollPending(live, matchId)) return;
        await dispatch(onlineMatchApi.endpoints.rollDice.initiate(matchId, {
          fixedCacheKey: rollDiceCacheKey(matchId),
        }),).unwrap();
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        console.warn('[onlineMatch] auto-roll failed', err);
      }
    },
  });

  let armedClaimDeadline: number | null = null;

  startListening({
    matcher: isAnyOf(snapshotFulfilled, opponentActivityObserved, opponentPresenceChanged, onlineMatchRouteEntered, onlineMatchRouteExited,),
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState,
      signal
    }) => {
      if (onlineMatchRouteExited.match(action) || onlineMatchRouteEntered.match(action)) {
        armedClaimDeadline = null;
        cancelActiveListeners();
        return;
      }

      const matchId = sessionMatchId(getState());
      if (matchId === undefined) return;
      const state = getState();
      const match = selectMatch(state, matchId);
      if (!match?.opponent_id || selectMatchFinished(state, matchId)) return;

      const presenceDeadline = selectPresenceForfeitDeadlineMs(state, matchId);
      const inactivityDeadline = selectInactivityDeadlineMs(state, matchId);
      const deadline = presenceDeadline === null ? inactivityDeadline : inactivityDeadline === null ? presenceDeadline : Math.min(presenceDeadline, inactivityDeadline);
      if (deadline === null || deadline === armedClaimDeadline) return;

      cancelActiveListeners();
      armedClaimDeadline = deadline;

      try {
        await delay(Math.max(0, deadline - Date.now()));
        if (signal.aborted) return;

        const live = getState();
        if (selectMatchFinished(live, matchId)) return;
        if (!selectMatch(live, matchId)?.opponent_id) return;
        const now = Date.now();
        const livePresence = selectPresenceForfeitDeadlineMs(live, matchId);
        const liveInactivity = selectInactivityDeadlineMs(live, matchId);
        // Presence loss needs no turn check — gone is gone. The time-based path
        // is gated on the opponent's turn so we never claim mid-move.
        const byDisconnect = livePresence !== null && now >= livePresence;
        const byInactivity = liveInactivity !== null && now >= liveInactivity && !selectIsLocalTurn(live, matchId);
        if (!byDisconnect && !byInactivity) return;

        dispatch(opponentInactivityDeadlineReached());
        // Release the arm so the next trigger re-evaluates an already-expired
        // deadline: that is what lets a retryable conversion failure retry.
        armedClaimDeadline = null;
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        console.warn('[onlineMatch] inactivity watch failed', err);
      }
    },
  });

  // The claim action re-fires while the deadline still holds, so an in-flight
  // flag stands in for the old ref latch: a retryable conversion simply drops
  // the flag and the next re-fire retries.
  let forfeitInFlight = false;

  startListening({
    matcher: isAnyOf(opponentInactivityDeadlineReached, onlineMatchRouteEntered, onlineMatchRouteExited,),
    effect: async (action, {
      cancelActiveListeners,
      dispatch,
      getState,
      signal
    }) => {
      if (onlineMatchRouteExited.match(action) || onlineMatchRouteEntered.match(action)) {
        forfeitInFlight = false;
        cancelActiveListeners();
        return;
      }
      if (forfeitInFlight) return;

      const state = getState();
      const matchId = sessionMatchId(state);
      const match = matchId === undefined ? null : selectMatch(state, matchId);
      const localColor = matchId === undefined ? null : selectLocalColor(state, matchId);
      const userId = state.auth.userId;
      if (matchId === undefined || !match || !localColor || userId === null) return;

      forfeitInFlight = true;
      try {
        try {
          await dispatch(onlineMatchApi.endpoints.convertOpponentToAi.initiate({
            matchId,
            minInactiveSeconds: Math.floor(state.onlineMatch.inactivityForfeitMs / 1000),
          }, {track: false},),).unwrap();
        }
        catch (err) {
          const kind = classifyConversionError(err instanceof Error ? err.message : String((err as {
            message?: string
          })?.message ?? err),);
          // retryable: a concurrent caller won, or activity was seen. fatal:
          // surface nothing here but do not finalise a match we failed to convert.
          if (kind !== 'terminal') {
            forfeitInFlight = false;
            return;
          }
        }

        if (signal.aborted) return;
        const opponentIsOwner = userId === match.opponent_id;
        const scores = buildFinalizeScores(match, localColor);
        await dispatch(onlineMatchApi.endpoints.finalizeMatch.initiate({
          matchId,
          whiteScore: scores.whiteScore,
          blackScore: scores.blackScore,
          winner: localColor,
          crawfordGameNumber: match.crawford_game_number ?? null,
          ownerAbandoned: opponentIsOwner,
          opponentAbandoned: !opponentIsOwner,
          userId,
        }, {track: false},),).unwrap();
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        // match_already_finished is not a failure; anything else releases the
        // flag so a manual claim or the next re-fire can retry.
        if (!message.includes('match_already_finished')) {
          console.error('[onlineMatch] auto-forfeit finalize failed', message);
          forfeitInFlight = false;
        }
      }
    },
  });

  // At most one invoke per distinct board state, so a failing ai_move cannot
  // spin. Route entry clears the key: a fresh session may need the same poke.
  let lastPokedKey: string | null = null;

  startListening({
    matcher: isAnyOf(snapshotFulfilled, onlineMatchRouteEntered, onlineMatchRouteExited),
    effect: async (action, {
      cancelActiveListeners,
      dispatch,
      getState,
      signal
    }) => {
      if (onlineMatchRouteExited.match(action) || onlineMatchRouteEntered.match(action)) {
        lastPokedKey = null;
        cancelActiveListeners();
        return;
      }

      const matchId = sessionMatchId(getState());
      if (matchId === undefined) return;
      const key = selectBotPokeKey(getState(), matchId);
      if (key === null || key === lastPokedKey) return;
      lastPokedKey = key;

      try {
        await dispatch(onlineMatchApi.endpoints.aiMove.initiate(matchId, {track: false}),).unwrap();
      }
      catch (err) {
        if (err instanceof TaskAbortError || signal.aborted) return;
        console.error('[onlineMatch] ai_move failed', err);
      }
    },
  });
}
