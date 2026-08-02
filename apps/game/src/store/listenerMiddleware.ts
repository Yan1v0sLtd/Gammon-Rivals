import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
  replayTick,
} from '../features/replay/replaySlice';
import type { AppDispatch, RootState } from './store';

const REPLAY_TICK_DELAY_MS = 1400;

const replayControlMatcher = isAnyOf(
  replayPlay,
  replayPause,
  replaySeek,
  replayRouteEntered,
  replayRouteExited,
);

export function createReplayListenerMiddleware() {
  const listener = createListenerMiddleware();
  const startListening = listener.startListening.withTypes<RootState, AppDispatch>();

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
