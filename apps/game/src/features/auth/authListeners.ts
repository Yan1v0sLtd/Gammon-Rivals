import { isAnyOf } from '@reduxjs/toolkit';
import { supabase } from '../../lib/supabase';
import { baseApi } from '../../store/baseApi';
import type { AppStartListening } from '../../store/listenerTypes';
import {
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
} from './authSlice';
import { playerDataApi } from '../playerData/playerDataApi';

const authLifecycleMatcher = isAnyOf(
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
);

export function startAuthListeners(startListening: AppStartListening): void {
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
}
