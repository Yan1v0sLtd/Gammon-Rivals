import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './baseApi';
import { createAppListenerMiddleware } from './listenerMiddleware';
import replayReducer from '../features/replay/replaySlice';
import authReducer from '../features/auth/authSlice';

export function createAppStore() {
  const listener = createAppListenerMiddleware();
  return configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      auth: authReducer,
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
