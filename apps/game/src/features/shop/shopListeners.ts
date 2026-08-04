import {warmImages} from "../../lib/warmImages"
import {baseApi} from "../../store/baseApi"
import type {AppStartListening} from "../../store/listenerTypes"

import {shopGrantConfirmed, shopWarmupRequested} from "./shopActions"
import {shopApi} from "./shopApi"

const SHOP_WALLET_REFRESH_DELAY_MS = 600
const SHOP_WARMUP_DELAY_MS = 1500

export function startShopListeners(startListening: AppStartListening): void {
  startListening({
    actionCreator: shopWarmupRequested,
    effect: async (_action, {cancelActiveListeners, delay, dispatch}) => {
      cancelActiveListeners()
      try {
        // Keep the boot-time work off the lobby's startup path; cancellation
        // also prevents duplicate StrictMode mounts from warming twice.
        await delay(SHOP_WARMUP_DELAY_MS)
        void import("../../pages/Shop").catch(() => undefined)
        const [catalog, config] = await Promise.all([
          dispatch(shopApi.endpoints.getShopCatalog.initiate(undefined, {subscribe: false}))
            .unwrap()
            .catch(() => []),
          dispatch(shopApi.endpoints.getStoreConfig.initiate(undefined, {subscribe: false}))
            .unwrap()
            .catch(() => null),
        ])
        void dispatch(shopApi.endpoints.getStoreSale.initiate(undefined, {subscribe: false}))
        warmImages([...catalog.map((row) => row.image_url), config?.bgImageUrl])
      }
      catch {
        // Listener cancellation is expected when a newer warm-up supersedes this one.
      }
    },
  })

  // Post-purchase player-data refresh. The Shop funnels both purchase paths
  // (gem RPC + Play Billing/USD) through shopGrantConfirmed so this one
  // workflow owns the wallet + XP-boost refresh for every grant. The 600 ms
  // wallet delay is animation choreography, not a data concern: the
  // reward-flight tokens visually land in the balance before the number
  // ticks up. No cancelActiveListeners — two purchases in a row must each
  // get their own refresh.
  startListening({
    actionCreator: shopGrantConfirmed,
    effect: async (action, {
      delay,
      dispatch,
    }) => {
      dispatch(baseApi.util.invalidateTags([{
        type: "XpBoost",
        id: action.payload.userId,
      }]))
      await delay(SHOP_WALLET_REFRESH_DELAY_MS)
      dispatch(baseApi.util.invalidateTags([{
        type: "Wallet",
        id: action.payload.userId,
      }]))
    },
  })
}
