import { isSupabaseConfigured, supabase } from './supabase';
import type { Database } from '@shared/database';

type ShopItemRow = Database['public']['Tables']['shop_items']['Row'];

export interface ShopSale {
  readonly label: string;
  readonly bonusPercent: number;
  readonly endsAt: string | null;
}

export interface ShopStoreConfig {
  readonly title: string;
  readonly bgImageUrl: string | null;
}

export interface ShopCatalogCache {
  rows: readonly ShopItemRow[];
  sale: ShopSale | null;
  config: ShopStoreConfig | null;
}

/**
 * Module-level warm cache for the Store popup.
 *
 * Why: the shop used to do ALL its work at tap time — lazy-load the JS
 * chunk, query shop_items (+ sale + store_config), then download & decode
 * every pack's art before revealing (the reveal gate). On a phone that
 * stacked up to multi-second "bundles pop in late".
 *
 * ShopProvider calls prefetchShopCatalog() once the app is idle after
 * boot; the Shop component seeds its state from getShopCatalogCache() so
 * a warmed open renders the full catalog on its first frame (a background
 * refetch still runs to stay fresh — cache is a head start, not a source
 * of truth).
 */
let cache: ShopCatalogCache | null = null;
let inflight: Promise<ShopCatalogCache | null> | null = null;

export function getShopCatalogCache(): ShopCatalogCache | null {
  return cache;
}

/** Merge a fresher catalog (from the Shop's own fetch) into the cache. */
export function updateShopCatalogCache(patch: Partial<ShopCatalogCache>): void {
  cache = {
    rows: patch.rows ?? cache?.rows ?? [],
    sale: patch.sale !== undefined ? patch.sale : cache?.sale ?? null,
    config: patch.config !== undefined ? patch.config : cache?.config ?? null,
  };
}

/** Fire the browser's image pipeline for the catalog art so the Store's
 *  image-preload reveal gate is instant when it opens. Fire-and-forget. */
function warmCatalogImages(next: ShopCatalogCache): void {
  const urls = new Set<string>();
  for (const row of next.rows) {
    if (row.image_url) urls.add(row.image_url);
  }
  if (next.config?.bgImageUrl) urls.add(next.config.bgImageUrl);
  for (const url of urls) {
    const img = new Image();
    img.src = url;
  }
}

export function prefetchShopCatalog(): Promise<ShopCatalogCache | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = (async (): Promise<ShopCatalogCache | null> => {
    const { data: rows, error } = await supabase
      .from('shop_items')
      .select('*')
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true });
    if (error || !rows) {
      // Leave the cache empty so the Shop's own fetch (with its retry UI)
      // stays the source of truth; a later prefetch call may retry.
      inflight = null;
      return null;
    }

    const next: ShopCatalogCache = { rows, sale: null, config: null };

    // Sale + storefront config are best-effort enhancements (same as the
    // Shop's own load) — a failure must not lose the catalog warm-up.
    const [saleRes, cfgRes] = await Promise.allSettled([
      supabase.rpc('current_store_sale'),
      supabase.from('store_config').select('title, bg_image_url').eq('id', true).maybeSingle(),
    ]);
    if (saleRes.status === 'fulfilled' && !saleRes.value.error && saleRes.value.data?.length) {
      const s = saleRes.value.data[0];
      next.sale = { label: s.label, bonusPercent: s.bonus_percent, endsAt: s.ends_at };
    }
    if (cfgRes.status === 'fulfilled' && !cfgRes.value.error && cfgRes.value.data) {
      next.config = {
        title: cfgRes.value.data.title || 'Store',
        bgImageUrl: cfgRes.value.data.bg_image_url,
      };
    }

    cache = next;
    inflight = null;
    warmCatalogImages(next);
    return cache;
  })();

  return inflight;
}
