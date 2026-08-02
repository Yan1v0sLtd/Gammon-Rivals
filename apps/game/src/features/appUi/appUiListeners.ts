import {isAnyOf} from '@reduxjs/toolkit';
import type {AppStartListening} from '../../store/listenerTypes';
import {
  NAV_LOADER_OVERLAY_FADE_OUT_MS,
  navigationLoaderOverlayFadeStarted,
  navigationLoaderOverlayHidden,
  navigationLoaderOverlayShown,
} from './appUiSlice';

const navigationLoaderOverlayMatcher = isAnyOf(navigationLoaderOverlayShown, navigationLoaderOverlayFadeStarted, navigationLoaderOverlayHidden,);

export function startAppUiListeners(startListening: AppStartListening): void {
  // Owns the navigation loader overlay's fade-out→unmount timer. A re-show
  // or a fresh hide supersedes a pending unmount (cancelActiveListeners).
  // Only a genuine 'visible' → 'fading-out' transition may schedule the
  // unmount: redundant fade requests are reducer no-ops and must leave the
  // in-flight timer untouched, exactly as the old useEffect([phase])
  // bail-out did.
  startListening({
    matcher: navigationLoaderOverlayMatcher,
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getOriginalState
    }) => {
      if (navigationLoaderOverlayFadeStarted.match(action)) {
        // A redundant hide() while already fading is a reducer no-op; the old
        // useEffect([phase]) did not re-run, so the in-flight timer must survive.
        if (getOriginalState().appUi.navigationLoaderOverlayPhase !== 'visible') return;
        cancelActiveListeners();
        await delay(NAV_LOADER_OVERLAY_FADE_OUT_MS);
        dispatch(navigationLoaderOverlayHidden());
        return;
      }
      // navigationLoaderOverlayShown / navigationLoaderOverlayHidden supersede a pending unmount.
      cancelActiveListeners();
    },
  });
}
