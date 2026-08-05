import {useCallback} from "react"

import {useAppDispatch} from "../../store/hooks"

import {appUiActions} from "./appUiSlice"

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
  const show = useCallback(() => dispatch(appUiActions.navigationLoaderOverlayShown()), [dispatch])
  const hide = useCallback(() => dispatch(appUiActions.navigationLoaderOverlayFadeStarted()), [dispatch])
  return {
    show,
    hide,
  }
}
