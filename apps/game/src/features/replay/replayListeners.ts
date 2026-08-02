import {isAnyOf} from '@reduxjs/toolkit';
import type {AppStartListening} from '../../store/listenerTypes';
import {replayPause, replayPlay, replayRouteEntered, replayRouteExited, replaySeek, replayTick,} from './replaySlice';

const REPLAY_TICK_DELAY_MS = 1400;

const replayControlMatcher = isAnyOf(replayPlay, replayPause, replaySeek, replayRouteEntered, replayRouteExited,);

export function startReplayListeners(startListening: AppStartListening): void {
  startListening({
    matcher: replayControlMatcher,
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState
    }) => {
      cancelActiveListeners();
      if (!replayPlay.match(action)) return;
      const totalPlies = action.payload.totalPlies;
      while (getState().replay.playing) {
        await delay(REPLAY_TICK_DELAY_MS);
        dispatch(replayTick({totalPlies}));
      }
    },
  });
}
