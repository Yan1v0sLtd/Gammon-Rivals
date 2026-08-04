import {lazy, Suspense, useCallback, useEffect} from "react"

import {selectIsShopOpen} from "../features/appUi/appUiSelectors"
import {shopClosed} from "../features/appUi/appUiSlice"
import {shopWarmupRequested} from "../features/shop/shopActions"
import {useBodyModalFlag} from "../lib/bodyModalFlag"
import {useAppDispatch, useAppSelector} from "../store/hooks"

// Lazy so the (large) shop bundle is only fetched the first time the
// popup opens, not in the initial app payload.
const ShopModal = lazy(() => import("../pages/Shop").then((m) => ({default: m.ShopModal})))

/**
 * App-wide shop popup host. Mount once near the app root (inside
 * app root, so the shop can read the wallet. Any descendant calls
 * `useShop().openShop()` to pop the shop — as a scale-in popup — over the
 * current screen. The lobby Special Offers icon + top-bar balances, the
 * Difficulty modal's "Get Coins", the Profile balance buttons, and the
 * /shop deep link all funnel here, so there's one shop UX everywhere.
 * Shop visibility lives in the appUi Redux slice; this component only
 * renders the popup that reflects it.
 */
export function ShopHost() {
  const isShopOpen = useAppSelector(selectIsShopOpen)
  const dispatch = useAppDispatch()
  const closeShop = useCallback(() => dispatch(shopClosed()), [dispatch])
  // Pause the lobby's ambient animations while the shop covers them.
  useBodyModalFlag(isShopOpen)

  useEffect(() => {
    dispatch(shopWarmupRequested())
  }, [dispatch])

  return isShopOpen ? (<Suspense fallback={null}>
    <ShopModal onClose={closeShop}/>
  </Suspense>) : null
}
