import { createContext, useContext } from 'react';

export interface ShopContextValue {
  readonly openShop: () => void;
  readonly closeShop: () => void;
  readonly isShopOpen: boolean;
}

export const ShopContext = createContext<ShopContextValue | null>(null);

export function useShop(): ShopContextValue {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error('useShop must be used within a ShopProvider');
  }
  return context;
}
