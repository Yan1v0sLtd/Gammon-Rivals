import { isSupabaseConfigured, supabase } from './supabase';
import type { Database } from '../../../../packages/shared/src/database';

export type ShopItemRow = Database['public']['Tables']['shop_items']['Row'];

export interface ShopSale {
  readonly label: string;
  readonly bonusPercent: number;
  readonly endsAt: string | null;
}

export interface ShopStoreConfig {
  readonly title: string;
  readonly bgImageUrl: string | null;
}

/**
 * The enabled shop catalog — the gating fetch that drives the Shop's
 * retry UI, so its errors must surface. An empty result (or an
 * unconfigured Supabase) is a legitimately empty store, not a failure.
 */
export async function fetchShopCatalog(): Promise<readonly ShopItemRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('shop_items')
    .select('*')
    .eq('is_enabled', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Best-effort presentation enhancement: a running Store Sale boosts the
 * badges + amounts. NEVER throws — a sale outage must not block the
 * store, so errors (and the no-config / no-row cases) resolve to null
 * exactly like the old `Promise.allSettled`/ignored-error behavior.
 */
export async function fetchStoreSale(): Promise<ShopSale | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('current_store_sale');
    if (error || !data || data.length === 0) return null;
    return {
      label: data[0].label,
      bonusPercent: data[0].bonus_percent,
      endsAt: data[0].ends_at,
    };
  } catch {
    return null;
  }
}

/**
 * Storefront presentation config (BO-editable singleton): header title +
 * optional themed background. Same never-throws rule as the sale — a
 * config outage must not block the store, so it resolves to null on any
 * failure and the Shop falls back to its defaults.
 */
export async function fetchStoreConfig(): Promise<ShopStoreConfig | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('store_config')
      .select('title, bg_image_url')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    return { title: data.title || 'Store', bgImageUrl: data.bg_image_url };
  } catch {
    return null;
  }
}

/**
 * Purchase a shop item. The RPC's error message is preserved verbatim
 * because the Shop pattern-matches its known failure codes
 * (unsupported_grant / insufficient_gems / already_owned_board /
 * purchase_limit_reached) on it.
 */
export async function purchaseShopItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('purchase_shop_item', { target_item_id: itemId });
  if (error) throw new Error(error.message);
}
