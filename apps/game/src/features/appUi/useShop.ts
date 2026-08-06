import {useCallback} from "react"

import {useAppDispatch, useAppSelector} from "../../store/hooks"

import {selectIsShopOpen} from "./appUiSelectors"
import {appUiActions} from "./appUiSlice"

export type ShopControls = {
  readonly openShop: () => void,
  readonly closeShop: () => void,
  readonly isShopOpen: boolean,
}

/**
 * Controls for the app-wide shop popup. The appUi slice is the single owner
 * of `shopOpen`; every entry point (lobby top-bar balances, Special Offers,
 * the Difficulty modal's "Get Coins", the Profile balances) goes through
 * here, and ShopHost renders whatever the flag says.
 */
export function useShop(): ShopControls {
  const dispatch = useAppDispatch()
  const isShopOpen = useAppSelector(selectIsShopOpen)
  // useCallback([dispatch]) keeps these stable so callers can depend on them
  // in effects without re-firing on every render.
  const openShop = useCallback(() => {
    dispatch(appUiActions.shopOpened())
  }, [dispatch])
  const closeShop = useCallback(() => {
    dispatch(appUiActions.shopClosed())
  }, [dispatch])
  return {
    openShop,
    closeShop,
    isShopOpen,
  }
}
