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
 * Compatibility hook over the appUi slice for the app-wide shop popup.
 * The slice is the single owner of `shopOpen`; consumers keep the exact
 * `{ openShop, closeShop, isShopOpen }` shape the old shop context gave.
 */
export function useShop(): ShopControls {
  const dispatch = useAppDispatch()
  const isShopOpen = useAppSelector(selectIsShopOpen)
  // useCallback([dispatch]) keeps these stable so effects that depend on
  // openShop (e.g. ShopRoute's redirect) never re-fire on re-render.
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
