import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface ReplayState {
  readonly ply: number;
  readonly playing: boolean;
}

export function createInitialReplayState(): ReplayState {
  return { ply: 0, playing: false };
}

interface BoundedPayload {
  readonly totalPlies: number;
}

interface SeekPayload extends BoundedPayload {
  readonly ply: number;
}

function clampToTotal(ply: number, totalPlies: number): number {
  return Math.min(Math.max(0, ply), Math.max(0, totalPlies));
}

export const replaySlice = createSlice({
  name: 'replay',
  initialState: createInitialReplayState(),
  reducers: {
    replayRouteEntered: () => createInitialReplayState(),
    replayRouteExited: () => createInitialReplayState(),
    replaySeek(state, action: PayloadAction<SeekPayload>) {
      state.ply = clampToTotal(action.payload.ply, action.payload.totalPlies);
      state.playing = false;
    },
    replayPlay(state, action: PayloadAction<BoundedPayload>) {
      const total = Math.max(0, action.payload.totalPlies);
      if (state.ply >= total) state.ply = 0;
      state.playing = total > 0;
    },
    replayPause(state) {
      state.playing = false;
    },
    replayTick(state, action: PayloadAction<BoundedPayload>) {
      const total = Math.max(0, action.payload.totalPlies);
      if (state.ply >= total) {
        state.playing = false;
        return;
      }
      state.ply += 1;
      state.playing = state.ply < total;
    },
  },
});

export const {
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
  replayPlay,
  replayPause,
  replayTick,
} = replaySlice.actions;

export default replaySlice.reducer;
