import { createListenerMiddleware } from '@reduxjs/toolkit';
import { startAppUiListeners } from '../features/appUi/appUiListeners';
import { startAuthListeners } from '../features/auth/authListeners';
import { startDailyBonusListeners } from '../features/lobby/dailyBonusListeners';
import { startMatchmakingListeners } from '../features/lobby/matchmakingListeners';
import { startReplayListeners } from '../features/replay/replayListeners';
import { startShopListeners } from '../features/shop/shopListeners';
import type { AppDispatch, RootState } from './store';

export function createAppListenerMiddleware() {
  const listener = createListenerMiddleware();
  const startListening = listener.startListening.withTypes<RootState, AppDispatch>();

  // Feature workflows are registered from their own modules.
  startAuthListeners(startListening);
  startDailyBonusListeners(startListening);
  startMatchmakingListeners(startListening);
  startReplayListeners(startListening);
  startAppUiListeners(startListening);
  startShopListeners(startListening);

  return listener;
}
