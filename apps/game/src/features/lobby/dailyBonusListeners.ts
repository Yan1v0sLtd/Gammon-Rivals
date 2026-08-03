import { isAnyOf } from '@reduxjs/toolkit';
import { baseApi } from '../../store/baseApi';
import type { AppStartListening } from '../../store/listenerTypes';
import { dailyBonusClaimConfirmed } from './lobbyActions';
import {
  DAILY_BONUS_CLAIMED_MODAL_MS,
  dailyBonusClaimSucceeded,
  lobbyModalClosed,
  lobbyRouteExited,
} from './lobbySlice';

// Let the reward-flight tokens land before the wallet ticks up — animation choreography.
const DAILY_BONUS_WALLET_REFRESH_DELAY_MS = 600;

/**
 * The endpoint's dailyBonusClaimConfirmed refreshes server cache; the UI's
 * dailyBonusClaimSucceeded owns modal presentation.
 */
export function startDailyBonusListeners(startListening: AppStartListening): void {
  // A new claim supersedes a pending refresh (cancelActiveListeners); the
  // delay is a window for the identity to change — never refresh another user's cache.
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

  // A manual close or leaving the route retires the pending auto-close —
  // the timer outlives the component that started it.
  startListening({
    matcher: isAnyOf(dailyBonusClaimSucceeded, lobbyModalClosed, lobbyRouteExited),
    effect: async (action, { cancelActiveListeners, delay, dispatch, getState }) => {
      cancelActiveListeners();
      if (!dailyBonusClaimSucceeded.match(action)) return;
      await delay(DAILY_BONUS_CLAIMED_MODAL_MS);
      // Close only the modal this claim belongs to: a modal reopened meanwhile
      // starts with justClaimed === null, so a stale timer cannot shut it.
      const { modal } = getState().lobby;
      if (modal.kind !== 'dailyBonus' || modal.justClaimed?.day !== action.payload.day) return;
      dispatch(lobbyModalClosed());
    },
  });
}
