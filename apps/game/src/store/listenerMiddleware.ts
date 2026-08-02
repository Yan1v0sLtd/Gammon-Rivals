import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import {
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
} from '../features/auth/authSlice';
import { playerDataApi } from '../features/playerData/playerDataApi';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
  replayTick,
} from '../features/replay/replaySlice';
import { supabase } from '../lib/supabase';
import { baseApi } from './baseApi';
import type { AppDispatch, RootState } from './store';

const REPLAY_TICK_DELAY_MS = 1400;

const replayControlMatcher = isAnyOf(
  replayPlay,
  replayPause,
  replaySeek,
  replayRouteEntered,
  replayRouteExited,
);

const authLifecycleMatcher = isAnyOf(
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
);

export function createAppListenerMiddleware() {
  const listener = createListenerMiddleware();
  const startListening = listener.startListening.withTypes<RootState, AppDispatch>();

  // The reducer has already replaced the identity by the time this effect
  // runs, so the previous identity is tracked in the middleware closure.
  let lastAuthUserId: string | null = null;

  startListening({
    matcher: authLifecycleMatcher,
    effect: async (_action, { getState, dispatch }) => {
      const userId = getState().auth.userId;
      if (userId === lastAuthUserId) return;
      if (lastAuthUserId !== null) {
        dispatch(baseApi.util.resetApiState());
      }
      lastAuthUserId = userId;
    },
  });

  startListening({
    matcher: playerDataApi.endpoints.getProfile.matchFulfilled,
    effect: async (action, { getState, dispatch }) => {
      const currentUserId = getState().auth.userId;
      if (currentUserId === null || action.meta.arg.originalArgs !== currentUserId) return;
      if (!action.payload?.deleted_at) return;
      dispatch(authSignedOut());
      void supabase.auth.signOut().catch((err) => {
        console.error('Supabase sign-out failed after account deletion:', err);
      });
    },
  });

  startListening({
    matcher: replayControlMatcher,
    effect: async (action, { cancelActiveListeners, delay, dispatch, getState }) => {
      cancelActiveListeners();
      if (!replayPlay.match(action)) return;
      const totalPlies = action.payload.totalPlies;
      while (getState().replay.playing) {
        await delay(REPLAY_TICK_DELAY_MS);
        dispatch(replayTick({ totalPlies }));
      }
    },
  });

  return listener;
}
