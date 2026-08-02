import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/**
 * The lobby carousel "podium" (the stand the board sits on) used to be a
 * single hardcoded asset. It's now BO-managed: the `podium_images` table
 * holds a library and exactly one row is_active. This hook returns the
 * active podium's image URL, falling back to the original bundled asset
 * until (or unless) Supabase resolves — so the podium always renders.
 */
const FALLBACK_PODIUM = '/lobby/holders/royal-holder.webp';

export function useActivePodium(): string {
  const [url, setUrl] = useState<string>(FALLBACK_PODIUM);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void supabase
      .from('podium_images')
      .select('image_url')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data?.image_url) return;
        setUrl(data.image_url);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return url;
}
