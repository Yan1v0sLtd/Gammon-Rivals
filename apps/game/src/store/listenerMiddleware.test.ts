import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
} from '../features/replay/replaySlice';
import { createAppStore } from './store';
import type { AppStore } from './store';

describe('replay listener middleware', () => {
  let store: AppStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createAppStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const plies = () => store.getState().replay.ply;
  const playing = () => store.getState().replay.playing;

  it('starts playback without an early tick', async () => {
    store.dispatch(replayPlay({ totalPlies: 5 }));
    await vi.advanceTimersByTimeAsync(1300);
    expect(plies()).toBe(0);
    expect(playing()).toBe(true);
  });

  it('ticks at the 1400ms cadence', async () => {
    store.dispatch(replayPlay({ totalPlies: 5 }));
    await vi.advanceTimersByTimeAsync(1400);
    expect(plies()).toBe(1);
    await vi.advanceTimersByTimeAsync(1400);
    expect(plies()).toBe(2);
  });

  it('stops advancing once playback reaches the final ply', async () => {
    store.dispatch(replayPlay({ totalPlies: 2 }));
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(2);
    expect(playing()).toBe(false);
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(2);
  });

  it('cancels playback on pause', async () => {
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    store.dispatch(replayPause());
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(1);
    expect(playing()).toBe(false);
  });

  it('cancels playback on seek', async () => {
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    store.dispatch(replaySeek({ ply: 4, totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(4);
    expect(playing()).toBe(false);
  });

  it('cancels playback on route exit', async () => {
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    store.dispatch(replayRouteExited());
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(0);
    expect(playing()).toBe(false);
  });

  it('cancels playback on route entry', async () => {
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    store.dispatch(replayRouteEntered());
    await vi.advanceTimersByTimeAsync(2800);
    expect(plies()).toBe(0);
    expect(playing()).toBe(false);
  });

  it('restarts a fresh loop on a second play', async () => {
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    store.dispatch(replayPlay({ totalPlies: 10 }));
    await vi.advanceTimersByTimeAsync(1400);
    expect(plies()).toBe(2);
    expect(playing()).toBe(true);
  });
});
