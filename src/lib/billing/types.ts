// Plugin-agnostic billing seam. The Shop talks to a BillingService; the concrete
// impl is chosen at runtime — a native Play Billing service (cordova-plugin-
// purchase) on device, or a Mock (admin test-purchase RPC) on web/dev. This lets
// the buy UX be built + exercised in the browser before the native plugin and the
// on-device store exist, and keeps the plugin choice behind one interface.

export interface BillingPurchaseRequest {
  /** shop_items.id, e.g. "starter-bundle". */
  itemId: string;
  /** shop_items.google_product_id (the Play SKU), e.g. "starter_bundle". Used by
   *  the native flow; the mock ignores it. */
  productId?: string | null;
  /** Display label for toasts. */
  label: string;
}

export type BillingOutcome =
  | { status: 'granted' }
  | { status: 'cancelled' }
  | { status: 'pending' } // store accepted; grant will land asynchronously
  | { status: 'error'; code: string; message: string };

export interface BillingService {
  /** Run the purchase. On 'granted' the player's wallet has already been credited
   *  server-side (mock: the test RPC; native: a Google-validated token → grant). */
  purchase(req: BillingPurchaseRequest): Promise<BillingOutcome>;
}
