// Plugin-agnostic billing seam. The native app uses Play Billing; web builds
// use an unavailable implementation so operator grants stay in the Back Office.

export type BillingPurchaseRequest = {
  /** shop_items.id, e.g. "starter-bundle". */
  itemId: string,
  /** shop_items.google_product_id (the Play SKU), e.g. "starter_bundle". Used by
   *  the native flow; the mock ignores it. */
  productId?: string | null,
  /** Display label for toasts. */
  label: string,
}

export type BillingOutcome = | {status: "granted"} | {status: "cancelled"} | {status: "pending"} // store accepted; grant will land asynchronously
  | {status: "error", code: string, message: string}

export type BillingService = {
  /** On 'granted', the server has already credited the player's wallet. */
  purchase(req: BillingPurchaseRequest): Promise<BillingOutcome>,
}
