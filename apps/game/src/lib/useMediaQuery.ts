import {useCallback, useSyncExternalStore} from "react"

const MOBILE_LAYOUT_QUERY = "(max-aspect-ratio: 1.55/1)"

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * SSR-safe — reports `false` before hydration and re-syncs on the client.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === "undefined") return () => undefined
    const mediaQuery = window.matchMedia(query)
    mediaQuery.addEventListener("change", onStoreChange)
    return () => {
      mediaQuery.removeEventListener("change", onStoreChange)
    }
  }, [query])

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function useIsMobileLayout(): boolean {
  return useMediaQuery(MOBILE_LAYOUT_QUERY)
}
