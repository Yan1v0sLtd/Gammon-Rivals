import {configureStore} from "@reduxjs/toolkit"

import {appUiReducer} from "../features/appUi/appUiSlice"
import {authReducer} from "../features/auth/authSlice"
import {gameplayReducer} from "../features/gameplay/gameplaySlice"
import {lobbyReducer} from "../features/lobby/lobbySlice"
import {onlineMatchReducer} from "../features/onlineMatch/onlineMatchSlice"
import {replayReducer} from "../features/replay/replaySlice"

import {baseApi} from "./baseApi"
import {createAppListenerMiddleware} from "./listenerMiddleware"

export function createAppStore() {
  const listener = createAppListenerMiddleware()
  return configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      auth: authReducer,
      replay: replayReducer,
      appUi: appUiReducer,
      lobby: lobbyReducer,
      gameplay: gameplayReducer,
      onlineMatch: onlineMatchReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().prepend(listener.middleware).concat(baseApi.middleware),
    devTools: import.meta.env.DEV,
  })
}

export const store = createAppStore()

export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<AppStore["getState"]>
export type AppDispatch = AppStore["dispatch"]
