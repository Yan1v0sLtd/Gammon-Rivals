// Native Play Billing (Android device only), via cordova-plugin-purchase.
//
// Loaded ONLY through getBilling()'s native branch with a dynamic import(), so
// neither this module nor the plugin runtime ever enters the web bundle. On a
// device the plugin JS runs inside the Capacitor WebView and bridges to the
// native Google Play Billing library, exposing the global `CdvPurchase`.
//
// Flow:
//   order()  → Play purchase dialog → purchase token
//   → store.validator POSTs { shopItemId, purchaseToken } (+ buyer JWT) to the
//     validate-google-purchase edge fn, which verifies the token with Google and
//     grants via fulfill_google_purchase
//   → on `granted` we finish() (acknowledge/consume) and resolve purchase() as
//     'granted'.
//
// The SKU list is DATA — read from shop_items.google_product_id — never a
// hardcoded map (that map is exactly what drifted and caused the collision bug).
//
// ⚠️ The plugin is typed loosely (`any`) on purpose: cordova-plugin-purchase v13's
// event/receipt payload shapes and the exact runtime-availability of the global
// are verified ON DEVICE (test-license buy). See docs/billing/native-wiring.md.
// Everything WE own (server glue, SKU sourcing, outcome mapping) is typed.

import 'cordova-plugin-purchase';
import { supabase } from '../supabase';
import type { BillingService, BillingPurchaseRequest, BillingOutcome } from './types';

// The plugin sets `window.CdvPurchase` at runtime on device. Read it lazily
// (after app start / deviceready) rather than at module load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cdv = any;
function cdv(): Cdv {
  const g = (globalThis as unknown as { CdvPurchase?: Cdv }).CdvPurchase;
  if (!g) throw new Error('CdvPurchase unavailable — native (Play) build only');
  return g;
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-google-purchase`;

/** Final validator → server glue. POSTs the token with the buyer's Supabase JWT
 *  so the edge fn resolves profile_id from the token, not the request body. */
async function validateWithServer(
  shopItemId: string,
  purchaseToken: string,
): Promise<{ status?: string; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ shopItemId, purchaseToken }),
  });
  return (await res.json()) as { status?: string; error?: string };
}

export class NativeBillingService implements BillingService {
  private skuToItem: Record<string, string> = {};
  private itemToSku: Record<string, string> = {};
  private initPromise: Promise<void> | null = null;
  /** sku → resolver for the in-flight purchase() awaiting that product. */
  private pending = new Map<string, (o: BillingOutcome) => void>();

  /** Register every enabled real-money product and wire the store lifecycle.
   *  Runs at most once. */
  private ensureInitialized(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init().catch((e) => {
      // Reset so a later purchase can retry a transient init failure.
      this.initPromise = null;
      throw e;
    });
    return this.initPromise;
  }

  private async init(): Promise<void> {
    const { store, ProductType, Platform } = cdv();

    // SKU list from the DB (data, not code).
    const { data, error } = await supabase
      .from('shop_items')
      .select('id, google_product_id')
      .eq('is_enabled', true)
      .not('google_product_id', 'is', null)
      .not('price_cents', 'is', null);
    if (error) throw error;

    const rows = (data ?? []).filter(
      (r): r is { id: string; google_product_id: string } => Boolean(r.google_product_id),
    );
    for (const r of rows) {
      this.skuToItem[r.google_product_id] = r.id;
      this.itemToSku[r.id] = r.google_product_id;
    }

    store.register(
      rows.map((r) => ({
        id: r.google_product_id,
        type: ProductType.CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      })),
    );

    // token → our server → grant. ok:true only once the grant landed.
    store.validator = async (receipt: Cdv, callback: Cdv) => {
      const sku: string | undefined = receipt?.id ?? receipt?.transaction?.products?.[0]?.id;
      const token: string | undefined = receipt?.transaction?.purchaseToken;
      const itemId = sku ? this.skuToItem[sku] : undefined;
      if (!itemId || !token) {
        callback({ ok: false, code: store.INVALID_PAYLOAD, message: 'missing item/token' });
        return;
      }
      try {
        const r = await validateWithServer(itemId, token);
        if (r.status === 'granted' || r.status === 'already_fulfilled') {
          callback({ ok: true, data: {} });
        } else {
          callback({
            ok: false,
            code: store.INVALID_PAYLOAD,
            message: r.error ?? r.status ?? 'invalid',
          });
        }
      } catch (e) {
        callback({ ok: false, code: store.INVALID_PAYLOAD, message: (e as Error).message });
      }
    };

    store
      .when()
      .approved((t: Cdv) => t.verify())
      .verified((r: Cdv) => {
        r.finish();
        const sku: string | undefined = r?.id ?? r?.transaction?.products?.[0]?.id;
        if (sku) this.resolve(sku, { status: 'granted' });
      });

    await store.initialize([Platform.GOOGLE_PLAY]);
  }

  private resolve(sku: string, outcome: BillingOutcome): void {
    const r = this.pending.get(sku);
    if (r) {
      this.pending.delete(sku);
      r(outcome);
    }
  }

  async purchase(req: BillingPurchaseRequest): Promise<BillingOutcome> {
    try {
      await this.ensureInitialized();
    } catch (e) {
      return { status: 'error', code: 'init_failed', message: (e as Error).message };
    }

    const sku = req.productId ?? this.itemToSku[req.itemId];
    if (!sku) {
      return { status: 'error', code: 'unknown_sku', message: `no Play SKU for ${req.itemId}` };
    }

    const { store, Platform, ErrorCode } = cdv();
    const offer = store.get(sku, Platform.GOOGLE_PLAY)?.getOffer?.();
    if (!offer) {
      return { status: 'error', code: 'no_offer', message: `store offer missing for ${sku}` };
    }

    // Arm the resolver before ordering so the verified handler can settle it.
    const settled = new Promise<BillingOutcome>((resolve) => this.pending.set(sku, resolve));

    const err = await offer.order();
    if (err) {
      this.pending.delete(sku);
      const cancelled = err.code === ErrorCode?.PAYMENT_CANCELLED;
      return cancelled
        ? { status: 'cancelled' }
        : { status: 'error', code: String(err.code ?? 'order_failed'), message: err.message ?? 'order failed' };
    }

    // Resolved by the verified handler (→ 'granted') once the server grants.
    return settled;
  }
}
