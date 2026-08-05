import {createSlice} from "@reduxjs/toolkit"

export type NavigationLoaderOverlayPhase = "hidden" | "visible" | "fading-out"

/**
 * How long the navigation loader overlay takes to fade out (and how long the
 * listener middleware waits before dispatching `navigationLoaderOverlayHidden`
 * to unmount it). Kept here so the overlay component's opacity transition
 * and the middleware's unmount timer can never drift apart.
 */
export const NAV_LOADER_OVERLAY_FADE_OUT_MS = 260

/**
 * App-shell client state: the app-wide shop popup and the route-spanning
 * navigation loader overlay. Both are application-level concerns that outlive
 * individual route components, so they live here (in Redux) rather than
 * in a component or context. Feature-specific modals stay in their own
 * feature slices — only shell-wide visibility belongs in this slice.
 */
export type AppUiState = {
  readonly shopOpen: boolean,
  readonly navigationLoaderOverlayPhase: NavigationLoaderOverlayPhase,
}

export function createInitialAppUiState(): AppUiState {
  return {
    shopOpen: false,
    navigationLoaderOverlayPhase: "hidden",
  }
}

export const appUiSlice = createSlice({
  name: "appUi",
  initialState: createInitialAppUiState(),
  reducers: {
    shopOpened: (state) => {
      state.shopOpen = true
    },
    shopClosed: (state) => {
      state.shopOpen = false
    },
    navigationLoaderOverlayShown: (state) => {
      state.navigationLoaderOverlayPhase = "visible"
    },
    navigationLoaderOverlayFadeStarted: (state) => {
      // Mirrors the old hide()'s `curr === 'visible' ? 'fading-out' : curr`
      // guard: a fade request while hidden/not-yet-visible is a no-op, so
      // the listener's `getState()` check below agrees with the reducer.
      if (state.navigationLoaderOverlayPhase === "visible") {
        state.navigationLoaderOverlayPhase = "fading-out"
      }
    },
    navigationLoaderOverlayHidden: (state) => {
      state.navigationLoaderOverlayPhase = "hidden"
    },
  },
})

export const appUiActions = appUiSlice.actions

export const appUiReducer = appUiSlice.reducer
