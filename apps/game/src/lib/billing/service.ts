import {Capacitor} from "@capacitor/core"

import {MockBillingService} from "./mockBilling"
import type {BillingService} from "./types"

let cached: BillingService | null = null

/**
 * Pick the billing implementation for this platform:
 *   • native (Android) → Play Billing via cordova-plugin-purchase
 *   • web / dev        → unavailable billing implementation
 *
 * The native module is loaded dynamically so its plugin code stays out of the
 * web bundle.
 */
export async function getBilling(): Promise<BillingService> {
  if (cached) return cached
  if (Capacitor.isNativePlatform()) {
    // Native Play Billing (cordova-plugin-purchase). Dynamic import keeps the
    // plugin runtime out of the web bundle. First draft — the plugin lifecycle
    // still needs an on-device test-license buy to confirm; see
    // docs/billing/native-wiring.md.
    const {NativeBillingService} = await import("./nativeBilling")
    cached = new NativeBillingService()
  }
  else {
    cached = new MockBillingService()
  }
  return cached
}
