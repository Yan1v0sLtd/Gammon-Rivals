import type {AppUiState, NavigationLoaderOverlayPhase} from "./appUiSlice"

/** Slice-of-root-state shape the appUi selectors read from. */
export type AppUiRootState = {
  readonly appUi: AppUiState,
}

export const selectIsShopOpen = (state: AppUiRootState): boolean => state.appUi.shopOpen

export const selectNavigationLoaderOverlayPhase = (state: AppUiRootState): NavigationLoaderOverlayPhase => state.appUi.navigationLoaderOverlayPhase
