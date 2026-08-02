import {useEffect, useMemo, useRef, useState} from 'react';

export interface PreloadStatus {
  /** True once every URL has resolved (loaded or errored). Always true
   *  when the URL list is empty. */
  readonly ready: boolean;
  readonly loaded: number;
  readonly total: number;
}

/**
 * Pre-fetches a set of image URLs so the browser cache is warm before
 * the consuming component renders. Returns `ready: true` once every URL
 * has either loaded or errored; errors don't block the gate because we
 * never want a missing asset to leave the user stuck on a loader.
 *
 * Each URL is fetched at most once for the lifetime of the component —
 * subsequent re-renders with the same URLs don't kick off duplicate
 * requests. Adding new URLs later (e.g. when remote board data arrives)
 * starts loads for the new ones only.
 */
export function useImagePreloader(urls: readonly (string | null | undefined)[]): PreloadStatus {
  const cleaned = useMemo<readonly string[]>(() => {
    const seen = new Set<string>();
    for (const u of urls) {
      if (typeof u === 'string' && u.length > 0) seen.add(u);
    }
    return Array.from(seen);
  }, [urls]);

  // Stable string key so the effect only re-runs when the URL set itself
  // changes, not when the parent re-renders with a new array reference.
  const cleanedKey = cleaned.join('|');

  const [loadedSet, setLoadedSet] = useState<ReadonlySet<string>>(() => new Set());
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Don't gate markLoaded on a `cancelled` flag: when the URL set
    // grows (e.g. board data arrives mid-flight and adds per-board image
    // URLs), this effect re-runs, the previous closure's cleanup sets
    // its own `cancelled` to true, and any onload from images that were
    // started by the prior run gets silently dropped — so loaded count
    // stalls below total and assetsReady never flips. React 18 already
    // makes setState-after-unmount safe; startedRef prevents duplicate
    // loads. So we just always record the load against the shared set.
    const markLoaded = (url: string) => {
      setLoadedSet((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    };
    for (const url of cleaned) {
      if (startedRef.current.has(url)) continue;
      startedRef.current.add(url);
      const img = new Image();
      img.onload = () => markLoaded(url);
      // Treat 404s / network errors as "loaded" — we don't want a missing
      // asset to keep the user stuck on the loading screen forever.
      img.onerror = () => markLoaded(url);
      img.src = url;
    }
    // cleaned is recomputed from useMemo; depend on the stable key so we
    // don't re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanedKey]);

  let loaded = 0;
  for (const u of cleaned) if (loadedSet.has(u)) loaded++;
  return {
    ready: cleaned.length === 0 || loaded === cleaned.length,
    loaded,
    total: cleaned.length,
  };
}
