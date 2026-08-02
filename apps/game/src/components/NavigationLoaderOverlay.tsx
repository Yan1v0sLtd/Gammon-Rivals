import { LoadingScreen } from './LoadingScreen';
import { useAppSelector } from '../store/hooks';
import { selectNavigationLoaderOverlayPhase } from '../features/appUi/appUiSelectors';
import { NAV_LOADER_OVERLAY_FADE_OUT_MS } from '../features/appUi/appUiSlice';

/**
 * Renders the route-spanning navigation loader overlay that lives above all
 * routes, so a navigation transition can be covered without flicker. The
 * overlay is hidden by default; route entry points call
 * `useNavigationLoaderOverlay().show()` before `navigate()`, and the
 * destination route calls `hide()` once its preload finishes. The overlay
 * fades out via opacity transition, then unmounts, so the new screen is
 * revealed cleanly underneath. The fade-out→unmount timer lives in the
 * appUi listener middleware — this component owns only the paint.
 */
export function NavigationLoaderOverlay() {
  const phase = useAppSelector(selectNavigationLoaderOverlayPhase);

  if (phase === 'hidden') return null;

  return (
    <div
      aria-hidden={phase !== 'visible'}
      className="fixed inset-0 z-[9999]"
      style={{
        opacity: phase === 'visible' ? 1 : 0,
        transition: `opacity ${NAV_LOADER_OVERLAY_FADE_OUT_MS}ms ease-out`,
        pointerEvents: phase === 'visible' ? 'auto' : 'none',
      }}
    >
      <LoadingScreen />
    </div>
  );
}
