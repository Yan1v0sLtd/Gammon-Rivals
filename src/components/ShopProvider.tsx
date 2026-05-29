import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

// Lazy so the (large) shop bundle is only fetched the first time the
// popup opens, not in the initial app payload.
const ShopModal = lazy(() =>
  import('../pages/Shop').then((m) => ({ default: m.ShopModal }))
);

interface ShopContextValue {
  readonly openShop: () => void;
  readonly closeShop: () => void;
  readonly isShopOpen: boolean;
}

const ShopContext = createContext<ShopContextValue | null>(null);

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

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) {
    throw new Error('useShop must be used within a ShopProvider');
  }
  return ctx;
}
