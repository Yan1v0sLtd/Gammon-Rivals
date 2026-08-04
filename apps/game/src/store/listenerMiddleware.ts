import {createListenerMiddleware} from "@reduxjs/toolkit"

import {startAppUiListeners} from "../features/appUi/appUiListeners"
import {startAuthListeners} from "../features/auth/authListeners"
import {startGameplayListeners} from "../features/gameplay/gameplayListeners"
import {startDailyBonusListeners} from "../features/lobby/dailyBonusListeners"
import {startMatchmakingListeners} from "../features/lobby/matchmakingListeners"
import {startOnlineMatchListeners} from "../features/onlineMatch/onlineMatchListeners"
import {startReplayListeners} from "../features/replay/replayListeners"
import {startShopListeners} from "../features/shop/shopListeners"

import type {AppDispatch, RootState} from "./store"

export function createAppListenerMiddleware() {
  const listener = createListenerMiddleware()
  const startListening = listener.startListening.withTypes<RootState, AppDispatch>()

  // Feature workflows are registered from their own modules.
  startAuthListeners(startListening)
  startGameplayListeners(startListening)
  startDailyBonusListeners(startListening)
  startMatchmakingListeners(startListening)
  startOnlineMatchListeners(startListening)
  startReplayListeners(startListening)
  startAppUiListeners(startListening)
  startShopListeners(startListening)

  return listener
}
