import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { prefetchShopCatalog } from '../lib/shopCache';
import { useBodyModalFlag } from '../lib/bodyModalFlag';
import { ShopContext } from './shopContext';

// Lazy so the (large) shop bundle is only fetched the first time the
// popup opens, not in the initial app payload.
const ShopModal = lazy(() =>
  import('../pages/Shop').then((m) => ({ default: m.ShopModal }))
);

/**
 * App-wide shop popup controller. Mount once near the app root (inside
 * AuthProvider, so the shop can read the wallet). Any descendant calls
 * `useShop().openShop()` to pop the shop — as a scale-in popup — over the
 * current screen. The lobby Special Offers icon + top-bar balances, the
 * Difficulty modal's "Get Coins", the Profile balance buttons, and the
 * /shop deep link all funnel here, so there's one shop UX everywhere.
 */
export function ShopProvider({ children }: { readonly children: ReactNode }) {
  const [isShopOpen, setIsShopOpen] = useState(false);
  const openShop = useCallback(() => setIsShopOpen(true), []);
  const closeShop = useCallback(() => setIsShopOpen(false), []);
  // Pause the lobby's ambient animations while the shop covers them.
  useBodyModalFlag(isShopOpen);

  // Warm the store while the app is idle so the FIRST open is instant.
  // Without this, tapping the Store stacked three costs at tap time on a
  // phone: lazy-load+parse the shop JS chunk, query the catalog, then
  // download every pack's art (the reveal gate) — seconds of "bundles pop
  // in late". requestIdleCallback keeps the warm-up out of the lobby's
  // own startup work; the timeout fallback covers WebViews without it.
  useEffect(() => {
    const warm = () => {
      void import('../pages/Shop');
      void prefetchShopCatalog();
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <ShopContext.Provider value={{ openShop, closeShop, isShopOpen }}>
      {children}
      {isShopOpen ? (
        <Suspense fallback={null}>
          <ShopModal onClose={closeShop} />
        </Suspense>
      ) : null}
    </ShopContext.Provider>
  );
}
