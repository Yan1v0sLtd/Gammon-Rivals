import { Capacitor } from '@capacitor/core';
import type { BillingService } from './types';
import { MockBillingService } from './mockBilling';

let cached: BillingService | null = null;

/**
 * Pick the billing implementation for this platform:
 *   • native (Android)  → real Play Billing via cordova-plugin-purchase
 *   • web / dev         → MockBillingService (admin test-purchase RPC)
 *
 * The native module will be loaded with a dynamic import() so its plugin code
 * never enters the web bundle. It's not wired yet — the native flow (order →
 * validated token → grant via the P2 edge function → finish) needs the AAB on an
 * internal-testing track to verify, so until then native falls back to the mock
 * and the build stays healthy.
 */
export async function getBilling(): Promise<BillingService> {
  if (cached) return cached;
  if (Capacitor.isNativePlatform()) {
    // Native Play Billing (cordova-plugin-purchase). Dynamic import keeps the
    // plugin runtime out of the web bundle. First draft — the plugin lifecycle
    // still needs an on-device test-license buy to confirm; see
    // docs/billing/native-wiring.md.
    const { NativeBillingService } = await import('./nativeBilling');
    cached = new NativeBillingService();
  } else {
    cached = new MockBillingService();
  }
  return cached;
}

export type { BillingService, BillingPurchaseRequest, BillingOutcome } from './types';
