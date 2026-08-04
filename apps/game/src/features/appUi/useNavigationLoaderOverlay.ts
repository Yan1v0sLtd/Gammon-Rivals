import {useCallback} from "react"

import {useAppDispatch} from "../../store/hooks"

import {navigationLoaderOverlayFadeStarted, navigationLoaderOverlayShown} from "./appUiSlice"

export type NavigationLoaderOverlayControls = {
  readonly show: () => void,
  readonly hide: () => void,
}

/**
 * Compatibility hook over the appUi slice for the route-spanning navigation
 * loader overlay. `hide()` starts the fade-out; the listener middleware owns
 * the actual unmount timer.
 */
export function useNavigationLoaderOverlay(): NavigationLoaderOverlayControls {
  const dispatch = useAppDispatch()
  const show = useCallback(() => dispatch(navigationLoaderOverlayShown()), [dispatch])
  const hide = useCallback(() => dispatch(navigationLoaderOverlayFadeStarted()), [dispatch])
  return {
    show,
    hide,
  }
}
