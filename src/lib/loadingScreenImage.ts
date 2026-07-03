import { isSupabaseConfigured, supabase } from './supabase';

/**
 * BO-managed loading-screen art (see the `loading_screen_images` table —
 * a library where exactly one row is active, same model as the podium).
 *
 * The loading screen is the FIRST thing painted (Suspense fallback + the
 * route-spanning navigation overlay), long before any network round-trip
 * can resolve — so the active URL is cached in localStorage and read
 * synchronously. Boot order:
 *
 *   1st ever launch  → bundled fallback (/loading/default.webp, in /public)
 *   later launches   → whatever the BO had active last time (cached)
 *
 * refreshLoadingScreenImage() runs once per session (fired from App mount):
 * it fetches the active row, PRELOADS the image, and only then writes the
 * cache — so a themed swap in the BO becomes visible from the next loading
 * screen on, always fully decoded, never a half-loaded flash.
 */

const FALLBACK_URL = '/loading/default.webp';
const CACHE_KEY = 'gr-loading-screen-url';

/** Synchronous getter used by LoadingScreen at render time. */
export function getLoadingScreenImage(): string {
  try {
    return window.localStorage.getItem(CACHE_KEY) || FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
}

let refreshed = false;

/** Fire-and-forget: sync the cache with the BO's active loading screen. */
export function refreshLoadingScreenImage(): void {
  if (refreshed || !isSupabaseConfigured) return;
  refreshed = true;

  void supabase
    .from('loading_screen_images')
    .select('image_url')
    .eq('is_active', true)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error || !data?.image_url) return;
      const url = data.image_url;
      if (url === getLoadingScreenImage()) return;

      // Warm the image before publishing it to the cache so the next
      // loading screen never paints a still-downloading background.
      const img = new Image();
      img.onload = () => {
        try {
          window.localStorage.setItem(CACHE_KEY, url);
        } catch {
          // Storage full/blocked — keep using the previous art.
        }
      };
      img.src = url;
    });
}
