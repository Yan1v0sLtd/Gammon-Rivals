import { useEffect } from 'react';

/**
 * Warms the browser cache for a set of image URLs AFTER the page is
 * interactive — scheduled on requestIdleCallback (with a short timeout
 * fallback), so it never competes with first-paint / critical assets.
 *
 * Fire-and-forget: no gating, no state. By the time the user opens a section
 * that uses these images (difficulty popup, How-to-Play, …) they're already in
 * the HTTP cache, so the section appears instantly instead of flashing in a
 * fraction of a second later. `new Image()` warms the cache for CSS
 * `background-image` usage too, not just <img>.
 *
 * Pass a STABLE (module-constant) url list so the effect runs once.
 */
export function usePrefetchOnIdle(urls: readonly string[]): void {
  useEffect(() => {
    if (urls.length === 0) return;
    let cancelled = false;

    const warm = () => {
      if (cancelled) return;
      for (const url of urls) {
        if (!url) continue;
        const img = new Image();
        img.src = url;
      }
    };

    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if (typeof window.requestIdleCallback === 'function') {
      // timeout ensures we still prefetch within 2.5s even if the main thread
      // never goes fully idle on a busy first load.
      idleHandle = window.requestIdleCallback(warm, { timeout: 2500 });
    } else {
      timeoutHandle = window.setTimeout(warm, 1200);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [urls]);
}
