import {lazy, Suspense, useCallback, useEffect} from "react"

import {useBodyModalFlag} from "../../lib/bodyModalFlag"
import {useAppDispatch, useAppSelector} from "../../store/hooks"
import {selectIsShopOpen} from "../appUi/appUiSelectors"
import {appUiActions} from "../appUi/appUiSlice"

import {shopWarmupRequested} from "./shopActions"

// Lazy so the (large) shop bundle is only fetched the first time the
// popup opens, not in the initial app payload.
const ShopModal = lazy(() => import("../../modals/Shop/ShopModal").then((m) => ({default: m.ShopModal})))

/**
 * App-wide shop popup host. Any descendant calls `useShop().openShop()` to
 * pop the shop — as a scale-in popup — over the current screen. The lobby
 * Special Offers icon + top-bar balances, the Difficulty modal's "Get
 * Coins" and the Profile balance buttons all funnel here, so there's one
 * shop UX everywhere. Shop visibility lives in the appUi Redux slice; this
 * component only renders the popup that reflects it.
 *
 * MUST stay mounted unconditionally at the router root: its mount effect is
 * the only dispatcher of `shopWarmupRequested`, so route-scoping this host
 * or gating it behind `isShopOpen` would silently kill the boot-time store
 * prefetch (bundle + catalog + pack art) and every open would be cold.
 */
export function ShopHost() {
  const isShopOpen = useAppSelector(selectIsShopOpen)
  const dispatch = useAppDispatch()
  const closeShop = useCallback(() => {
    dispatch(appUiActions.shopClosed())
  }, [dispatch])
  // Pause the lobby's ambient animations while the shop covers them.
  useBodyModalFlag(isShopOpen)

  useEffect(() => {
    dispatch(shopWarmupRequested())
  }, [dispatch])

  return isShopOpen ? (<Suspense fallback={null}>
    <ShopModal onClose={closeShop}/>
  </Suspense>) : null
}
