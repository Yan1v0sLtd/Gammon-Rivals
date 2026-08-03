import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
} from 'react';
import { shopApi } from '../features/shop/shopApi';
import type { ShopItemRow } from '../features/shop/shopData';
import { warmImages } from '../lib/warmImages';
import { useBodyModalFlag } from '../lib/bodyModalFlag';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectIsShopOpen } from '../features/appUi/appUiSelectors';
import { shopClosed } from '../features/appUi/appUiSlice';

// Lazy so the (large) shop bundle is only fetched the first time the
// popup opens, not in the initial app payload.
const ShopModal = lazy(() =>
  import('../pages/Shop').then((m) => ({ default: m.ShopModal }))
);

/**
 * App-wide shop popup host. Mount once near the app root (inside
 * AuthProvider, so the shop can read the wallet). Any descendant calls
 * `useShop().openShop()` to pop the shop — as a scale-in popup — over the
 * current screen. The lobby Special Offers icon + top-bar balances, the
 * Difficulty modal's "Get Coins", the Profile balance buttons, and the
 * /shop deep link all funnel here, so there's one shop UX everywhere.
 * Shop visibility lives in the appUi Redux slice; this component only
 * renders the popup that reflects it.
 */
export function ShopHost() {
  const isShopOpen = useAppSelector(selectIsShopOpen);
  const dispatch = useAppDispatch();
  const closeShop = useCallback(() => dispatch(shopClosed()), [dispatch]);
  // Pause the lobby's ambient animations while the shop covers them.
  useBodyModalFlag(isShopOpen);

  // Warm the store while the app is idle so the FIRST open is instant.
  // Without this, tapping the Store stacked three costs at tap time on a
  // phone: lazy-load+parse the shop JS chunk, query the catalog, then
  // download every pack's art (the reveal gate) — seconds of "bundles pop
  // in late". The catalog + storefront config are prefetched into the RTK
  // Query cache (subscribe: false) so they survive without a subscriber
  // until the modal mounts (see getShopCatalog's keepUnusedDataFor);
  // the browser image warm-up stays separate from that server-data cache.
  // requestIdleCallback keeps the warm-up out of the lobby's own startup
  // work; the timeout fallback covers WebViews without it.
  useEffect(() => {
    const warm = () => {
      void import('../pages/Shop').catch(() => undefined);
      void (async () => {
        const [catalog, config] = await Promise.all([
          dispatch(shopApi.endpoints.getShopCatalog.initiate(undefined, { subscribe: false }))
            .unwrap()
            .catch(() => [] as readonly ShopItemRow[]),
          dispatch(shopApi.endpoints.getStoreConfig.initiate(undefined, { subscribe: false }))
            .unwrap()
            .catch(() => null),
        ]);
        void dispatch(shopApi.endpoints.getStoreSale.initiate(undefined, { subscribe: false }));
        warmImages([...catalog.map((row) => row.image_url), config?.bgImageUrl]);
      })();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => {
        // Feature-detected separately: the DOM lib types both as always
        // present, but the WebViews that lack requestIdleCallback are the
        // same ones that can lack its canceller.
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, [dispatch]);

  return isShopOpen ? (
    <Suspense fallback={null}>
      <ShopModal onClose={closeShop} />
    </Suspense>
  ) : null;
}
