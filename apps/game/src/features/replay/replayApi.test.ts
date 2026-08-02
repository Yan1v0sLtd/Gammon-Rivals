import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGameWithMoves } from '../../lib/queries';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replayTick,
} from './replaySlice';
import { replayApi } from './replayApi';
import { createAppStore } from '../../store/store';
import type { AppStore } from '../../store/store';
import { makeGame, REPLAY_GAME_ID } from './testFixtures';

vi.mock('../../lib/queries', () => ({
  getGameWithMoves: vi.fn(),
}));

const mockedGetGameWithMoves = vi.mocked(getGameWithMoves);

describe('replayApi.getReplay', () => {
  let store: AppStore;

  beforeEach(() => {
    store = createAppStore();
    mockedGetGameWithMoves.mockReset();
  });

  it('fulfills with the exact repository payload', async () => {
    const game = makeGame();
    mockedGetGameWithMoves.mockResolvedValue(game);
    const result = await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    expect(result.data).toEqual(game);
    expect(result.error).toBeUndefined();
  });

  it('normalizes an Error rejection to a plain message', async () => {
    mockedGetGameWithMoves.mockRejectedValue(new Error('db down'));
    const result = await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    expect(result.error).toEqual({ message: 'db down' });
  });

  it('normalizes a message-bearing object rejection', async () => {
    mockedGetGameWithMoves.mockRejectedValue({ message: 'row missing' });
    const result = await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    expect(result.error).toEqual({ message: 'row missing' });
  });

  it('stringifies unknown rejections into a message', async () => {
    mockedGetGameWithMoves.mockRejectedValue('boom');
    const result = await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    expect(result.error).toEqual({ message: 'boom' });
  });

  it('calls the repository exactly once on failure', async () => {
    mockedGetGameWithMoves.mockRejectedValue(new Error('nope'));
    const result = await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    expect(mockedGetGameWithMoves).toHaveBeenCalledTimes(1);
    expect(result.error).toEqual({ message: 'nope' });
  });

  it('dedupes concurrent requests for the same game', async () => {
    mockedGetGameWithMoves.mockResolvedValue(makeGame());
    const first = store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    const second = store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    await Promise.all([first, second]);
    expect(mockedGetGameWithMoves).toHaveBeenCalledTimes(1);
  });

  it('emits no Redux serializability warnings for API and slice traffic', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetGameWithMoves.mockResolvedValue(makeGame());
    await store.dispatch(replayApi.endpoints.getReplay.initiate(REPLAY_GAME_ID));
    store.dispatch(replayPlay({ totalPlies: 1 }));
    store.dispatch(replayTick({ totalPlies: 1 }));
    store.dispatch(replayPause());
    store.dispatch(replayRouteEntered());
    store.dispatch(replayRouteExited());
    const messages = errorSpy.mock.calls.map((call) => call.map(String).join(' '));
    expect(messages.some((m) => m.includes('serializable') || m.includes('immutability'))).toBe(
      false,
    );
    errorSpy.mockRestore();
  });
});
