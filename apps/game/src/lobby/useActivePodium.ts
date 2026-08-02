import {isSupabaseConfigured} from '../lib/supabase';
import {useGetActivePodiumQuery} from '../features/lobby/lobbyApi';

/**
 * The lobby carousel "podium" (the stand the board sits on) used to be a
 * single hardcoded asset. It's now BO-managed: the `podium_images` table
 * holds a library and exactly one row is_active. This hook returns the
 * active podium's image URL, falling back to the original bundled asset
 * until (or unless) Supabase resolves — so the podium always renders.
 * The API caches the raw `string | null`; this default is a presentation
 * fallback applied only at the hook boundary, never stored in the cache.
 */
const FALLBACK_PODIUM = '/lobby/holders/royal-holder.webp';

export function useActivePodium(): string {
  const {data} = useGetActivePodiumQuery(undefined, {
    skip: !isSupabaseConfigured,
  });
  return data ?? FALLBACK_PODIUM;
}
