import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import {
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
} from '../features/auth/authSlice';
import { playerDataApi } from '../features/playerData/playerDataApi';
import { shopGrantConfirmed } from '../features/shop/shopActions';
import { dailyBonusClaimConfirmed } from '../features/lobby/lobbyActions';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
  replayTick,
} from '../features/replay/replaySlice';
import {
  NAV_LOADER_OVERLAY_FADE_OUT_MS,
  navigationLoaderOverlayFadeStarted,
  navigationLoaderOverlayHidden,
  navigationLoaderOverlayShown,
} from '../features/appUi/appUiSlice';
import { supabase } from '../lib/supabase';
import { baseApi } from './baseApi';
import type { AppDispatch, RootState } from './store';

const REPLAY_TICK_DELAY_MS = 1400;
const SHOP_WALLET_REFRESH_DELAY_MS = 600;
const DAILY_BONUS_WALLET_REFRESH_DELAY_MS = 600;

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

const navigationLoaderOverlayMatcher = isAnyOf(
  navigationLoaderOverlayShown,
  navigationLoaderOverlayFadeStarted,
  navigationLoaderOverlayHidden,
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

  // Owns the navigation loader overlay's fade-out→unmount timer. A re-show
  // or a fresh hide supersedes a pending unmount (cancelActiveListeners).
  // Only a genuine 'visible' → 'fading-out' transition may schedule the
  // unmount: redundant fade requests are reducer no-ops and must leave the
  // in-flight timer untouched, exactly as the old useEffect([phase])
  // bail-out did.
  startListening({
    matcher: navigationLoaderOverlayMatcher,
    effect: async (action, { cancelActiveListeners, delay, dispatch, getOriginalState }) => {
      if (navigationLoaderOverlayFadeStarted.match(action)) {
        // A redundant hide() while already fading is a reducer no-op; the old
        // useEffect([phase]) did not re-run, so the in-flight timer must survive.
        if (getOriginalState().appUi.navigationLoaderOverlayPhase !== 'visible') return;
        cancelActiveListeners();
        await delay(NAV_LOADER_OVERLAY_FADE_OUT_MS);
        dispatch(navigationLoaderOverlayHidden());
        return;
      }
      // navigationLoaderOverlayShown / navigationLoaderOverlayHidden supersede a pending unmount.
      cancelActiveListeners();
    },
  });

  // Post-purchase player-data refresh. The Shop funnels both purchase paths
  // (gem RPC + Play Billing/USD) through shopGrantConfirmed so this one
  // workflow owns the wallet + XP-boost refresh for every grant. The 600 ms
  // wallet delay is animation choreography, not a data concern: the
  // reward-flight tokens visually land in the balance before the number
  // ticks up. No cancelActiveListeners — two purchases in a row must each
  // get their own refresh.
  startListening({
    actionCreator: shopGrantConfirmed,
    effect: async (action, { delay, dispatch }) => {
      dispatch(baseApi.util.invalidateTags([{ type: 'XpBoost', id: action.payload.userId }]));
      await delay(SHOP_WALLET_REFRESH_DELAY_MS);
      dispatch(baseApi.util.invalidateTags([{ type: 'Wallet', id: action.payload.userId }]));
    },
  });

  // Post-claim player-data refresh. The delay lets the reward-flight tokens
  // land in the balance before the wallet ticks up. A new claim supersedes a
  // pending refresh (cancelActiveListeners), and the delay is a chance for
  // the identity to change — never invalidate another user's cache.
  startListening({
    actionCreator: dailyBonusClaimConfirmed,
    effect: async (action, { cancelActiveListeners, delay, dispatch, getState }) => {
      cancelActiveListeners();
      await delay(DAILY_BONUS_WALLET_REFRESH_DELAY_MS);
      if (getState().auth.userId !== action.payload.userId) return;
      dispatch(
        baseApi.util.invalidateTags([
          { type: 'Wallet', id: action.payload.userId },
          { type: 'Profile', id: action.payload.userId },
        ]),
      );
    },
  });

  return listener;
}
