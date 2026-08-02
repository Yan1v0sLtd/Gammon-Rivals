import { createContext, useContext } from 'react';

export interface NavigationOverlayContextValue {
  readonly show: () => void;
  readonly hide: () => void;
}

export const NavigationOverlayContext =
  createContext<NavigationOverlayContextValue | null>(null);

export function useNavigationOverlay(): NavigationOverlayContextValue {
  const context = useContext(NavigationOverlayContext);
  if (!context) {
    throw new Error('useNavigationOverlay() outside NavigationOverlayProvider');
  }
  return context;
}
