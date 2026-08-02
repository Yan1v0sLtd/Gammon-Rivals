import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { LoadingScreen } from '../components/LoadingScreen';
import { NavigationOverlayContext } from './navigationOverlayContext';

const FADE_OUT_MS = 260;

type Phase = 'hidden' | 'visible' | 'fading-out';

/**
 * Provides a route-spanning loader overlay that lives above all routes,
 * so a navigation transition can be covered without flicker. The
 * overlay is hidden by default; route entry points call `show()` before
 * `navigate()`, and the destination route calls `hide()` once its
 * preload finishes. The overlay fades out via opacity transition, then
 * unmounts, so the new screen is revealed cleanly underneath.
 */
export function NavigationOverlayProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('hidden');

  // Once we enter the fading-out state, schedule the actual unmount so
  // the DOM matches the visual after the transition finishes.
  useEffect(() => {
    if (phase !== 'fading-out') return;
    const id = window.setTimeout(() => setPhase('hidden'), FADE_OUT_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const show = useCallback(() => setPhase('visible'), []);
  const hide = useCallback(() => {
    setPhase((curr) => (curr === 'visible' ? 'fading-out' : curr));
  }, []);

  return (
    <NavigationOverlayContext.Provider value={{ show, hide }}>
      {children}
      {phase !== 'hidden' ? (
        <div
          aria-hidden={phase !== 'visible'}
          className="fixed inset-0 z-[9999]"
          style={{
            opacity: phase === 'visible' ? 1 : 0,
            transition: `opacity ${FADE_OUT_MS}ms ease-out`,
            pointerEvents: phase === 'visible' ? 'auto' : 'none',
          }}
        >
          <LoadingScreen />
        </div>
      ) : null}
    </NavigationOverlayContext.Provider>
  );
}
