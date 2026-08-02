import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './baseApi';
import { createReplayListenerMiddleware } from './listenerMiddleware';
import replayReducer from '../features/replay/replaySlice';

export function createAppStore() {
  const listener = createReplayListenerMiddleware();
  return configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      replay: replayReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listener.middleware).concat(baseApi.middleware),
    devTools: import.meta.env.DEV,
  });
}

export const store = createAppStore();

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
