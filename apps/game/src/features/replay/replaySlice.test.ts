import { describe, expect, it } from 'vitest';
import {
  createInitialReplayState,
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
  replaySlice,
  replayTick,
} from './replaySlice';

const reducer = replaySlice.reducer;

describe('createInitialReplayState', () => {
  it('returns a fresh reference per call with equal values', () => {
    const a = createInitialReplayState();
    const b = createInitialReplayState();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('replay route lifecycle', () => {
  it('resets client controls on route entry', () => {
    const dirty = { ...createInitialReplayState(), ply: 4, playing: true };
    expect(reducer(dirty, replayRouteEntered())).toEqual(createInitialReplayState());
  });

  it('resets client controls on route exit', () => {
    const dirty = { ...createInitialReplayState(), ply: 7, playing: true };
    expect(reducer(dirty, replayRouteExited())).toEqual(createInitialReplayState());
  });
});

describe('replaySeek', () => {
  it('clamps a negative seek to the first ply and pauses', () => {
    const state = { ...createInitialReplayState(), ply: 2, playing: true };
    expect(reducer(state, replaySeek({ ply: -3, totalPlies: 10 }))).toEqual({
      ply: 0,
      playing: false,
    });
  });

  it('clamps a seek past the last ply and pauses', () => {
    const state = { ...createInitialReplayState(), playing: true };
    expect(reducer(state, replaySeek({ ply: 50, totalPlies: 3 }))).toEqual({
      ply: 3,
      playing: false,
    });
  });

  it('lands on an exact ply and pauses', () => {
    const state = { ...createInitialReplayState(), playing: true };
    expect(reducer(state, replaySeek({ ply: 2, totalPlies: 5 }))).toEqual({
      ply: 2,
      playing: false,
    });
  });
});

describe('replayPlay', () => {
  it('starts playback from the current ply when before the end', () => {
    const state = { ...createInitialReplayState(), ply: 2 };
    expect(reducer(state, replayPlay({ totalPlies: 5 }))).toEqual({
      ply: 2,
      playing: true,
    });
  });

  it('restarts from the first ply when already at the end', () => {
    const state = { ...createInitialReplayState(), ply: 5 };
    expect(reducer(state, replayPlay({ totalPlies: 5 }))).toEqual({
      ply: 0,
      playing: true,
    });
  });

  it('never plays a zero-ply replay', () => {
    const state = createInitialReplayState();
    expect(reducer(state, replayPlay({ totalPlies: 0 }))).toEqual(createInitialReplayState());
  });

  it('ignores a negative total when deciding to play', () => {
    const state = createInitialReplayState();
    expect(reducer(state, replayPlay({ totalPlies: -2 }))).toEqual(createInitialReplayState());
  });
});

describe('replayPause', () => {
  it('stops playback without moving the ply', () => {
    const state = { ...createInitialReplayState(), ply: 3, playing: true };
    expect(reducer(state, replayPause())).toEqual({ ply: 3, playing: false });
  });
});

describe('replayTick', () => {
  it('advances one ply while playing before the end', () => {
    const state = { ...createInitialReplayState(), playing: true };
    expect(reducer(state, replayTick({ totalPlies: 5 }))).toEqual({
      ply: 1,
      playing: true,
    });
  });

  it('advances repeatedly until the final ply', () => {
    let state = { ...createInitialReplayState(), playing: true };
    for (let i = 0; i < 4; i++) {
      state = reducer(state, replayTick({ totalPlies: 5 }));
    }
    expect(state).toEqual({ ply: 4, playing: true });
  });

  it('completes playback on the last tick', () => {
    const state = { ...createInitialReplayState(), ply: 4, playing: true };
    expect(reducer(state, replayTick({ totalPlies: 5 }))).toEqual({
      ply: 5,
      playing: false,
    });
  });

  it('stays inert when already past the end', () => {
    const state = { ...createInitialReplayState(), ply: 5, playing: true };
    expect(reducer(state, replayTick({ totalPlies: 5 }))).toEqual({
      ply: 5,
      playing: false,
    });
  });
});
