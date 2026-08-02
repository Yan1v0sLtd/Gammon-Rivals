import type { NavigationLoaderOverlayPhase } from './appUiSlice';
import type { AppUiState } from './appUiSlice';

/** Slice-of-root-state shape the appUi selectors read from. */
export interface AppUiRootState {
  readonly appUi: AppUiState;
}

export const selectIsShopOpen = (state: AppUiRootState): boolean =>
  state.appUi.shopOpen;

export const selectNavigationLoaderOverlayPhase = (
  state: AppUiRootState,
): NavigationLoaderOverlayPhase => state.appUi.navigationLoaderOverlayPhase;
