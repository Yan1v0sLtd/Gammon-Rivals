# Play Billing — native wiring + deploy (do at the device stage)

Everything except the on-device plugin glue is built. This is the runbook to
finish it once the Play account is verified, the app exists, and we have an AAB on
an Internal testing track.

Pipeline: **Play purchase → token → `validate-google-purchase` edge fn verifies
with Google → `fulfill_google_purchase` grants → client `finish()` acknowledges.**

---

> **STATUS — updated 2026-07-02.** Most of this is DONE; the sections below are
> reference. What's actually left is **step 4 (build the release AAB) + step 5
> (on-device test-buy)**.
> - ✅ **9** one-time products live on the internal track — the coins ladder, NOT
>   the old 6-SKU list below. Play product IDs = `shop_items.google_product_id`,
>   all Play-valid unique slugs (`small_coin_pack_099` … `mega_coin_vault_9999`).
> - ✅ Service account `gammon-play-billing@gammon-rivals-501215.iam.gserviceaccount.com`
>   created + invited under **Users and permissions** with *View financial data* +
>   *Manage orders* (the old standalone "API access" page is gone from the
>   console); Google Play Android Developer API enabled on project
>   `gammon-rivals-501215`.
> - ✅ Supabase secrets set: `GOOGLE_SERVICE_ACCOUNT_JSON` + `ANDROID_PACKAGE_NAME`.
> - ✅ `src/lib/billing/nativeBilling.ts` implemented (first draft) + wired into
>   `getBilling()`. It sources the SKU list from `shop_items` (DATA — not the
>   hardcoded map in §3 below) and posts the token to the edge fn. **Its store
>   event lifecycle + validator payload still want an on-device test-license buy
>   to confirm** — that's why it's a draft.
> - ⚠️ Correction to §3: the client key env var is **`VITE_SUPABASE_PUBLISHABLE_KEY`**,
>   not `VITE_SUPABASE_ANON_KEY`. `handleUsdPurchase` is also still admin-gated, so
>   the first on-device test buy is done as an admin (regular-user un-gating is a
>   later launch step).

---

## 0. Prereqs (Play Console — gated on Google identity verification)
- App created (`com.gammonrivals.app`).
- 6 in-app products created, IDs matching `shop_items.google_product_id`:
  `small_coins, starter_bundle, xp_boost_7d, coin_stack, bowl_of_gems, mega_bundle`
  (all **Consumable**).
- Internal testing track with our AAB (built below) + your email as a **license
  tester** (Setup → License testing). Test-license buys don't charge.
- Service account for the Play Developer API (Setup → API access → link a Google
  Cloud project → create service account → grant it "View financial data / Manage
  orders" → download the JSON key).

## 1. Deploy the validator (P2) + set secrets
```sh
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
supabase secrets set ANDROID_PACKAGE_NAME=com.gammonrivals.app
supabase functions deploy validate-google-purchase
```sh
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` are injected
automatically. NEVER commit the JSON (repo is public).

## 2. Install the plugin
```sh
pnpm add cordova-plugin-purchase capacitor-plugin-cdv-purchase
pnpm exec cap sync android
```

## 3. Implement `src/lib/billing/nativeBilling.ts`
Implements `BillingService`. Registers the 6 SKUs, sets `store.validator` to POST
the token to our edge fn with the buyer's Supabase JWT, and resolves the outcome
on the transaction lifecycle. Then flip the `getBilling()` factory's native branch
to `await import('./nativeBilling')`.

Validator glue (this part is final — it calls the edge fn we already shipped):
```ts
import { supabase } from '../supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-google-purchase`;

async function validateWithServer(shopItemId: string, purchaseToken: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ shopItemId, purchaseToken }),
  });
  return res.json() as Promise<{ status?: string; error?: string }>;
}
```

Plugin skeleton (verify against the cordova-plugin-purchase v13 docs on-device):
```ts
import 'cordova-plugin-purchase';
const { store, ProductType, Platform } = CdvPurchase;

// SKU (Play product id) -> shop_items.id, since the server keys off shop item id.
const SKU_TO_ITEM: Record<string, string> = {
  small_coins: 'small-coins', starter_bundle: 'starter-bundle',
  xp_boost_7d: 'xp-boost-7d', coin_stack: 'coin-stack',
  bowl_of_gems: 'bowl-of-gems', mega_bundle: 'mega-bundle',
};

store.register(Object.keys(SKU_TO_ITEM).map((id) => ({
  id, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY,
})));

store.validator = async (receipt, callback) => {
  const tx = receipt.transaction;            // has purchaseToken + productId
  const itemId = SKU_TO_ITEM[receipt.id];
  const r = await validateWithServer(itemId, tx.purchaseToken!);
  if (r.status === 'granted' || r.status === 'already_fulfilled') callback({ ok: true, data: {} });
  else callback({ ok: false, code: store.INVALID_PAYLOAD, message: r.error ?? 'invalid' });
};

store.when().approved((t) => t.verify());     // -> runs validator
store.when().verified((r) => r.finish());     // acknowledge/consume once granted
await store.initialize([Platform.GOOGLE_PLAY]);

// BillingService.purchase(req): store.get(sku, Platform.GOOGLE_PLAY)
//   ?.getOffer()?.order(); then resolve 'granted' on the verified/finished event
//   for this product (or 'cancelled' on the cancelled event).
```

## 4. Build the AAB for the testing track
The store needs a self-contained bundle. The config is already one:
`capacitor.config.ts` sets `webDir: 'dist/play'` and has no `server.url`
(the game is Capacitor-only and `/play` is not web-served).
- `pnpm run build && pnpm exec cap sync android`
- In Android Studio: Build → Generated Signed App Bundle (or `./gradlew bundleRelease`).
- Upload the `.aab` to **Internal testing**, add testers, share the opt-in link.

## 5. Test
Install via the testing link on a device signed in as a license tester → open Shop
→ Buy → Google's test purchase dialog → token → our edge fn validates → gems/coins
land. `purchases` row recorded as `provider=google`. Re-buying the same token is a
no-op (idempotent). Then build P4 (refund handling via Real-time Developer
Notifications). Normal dev continues on the bundled `dist/play`: `pnpm run
android:sync` + rebuild/reinstall — no remote `server.url` workflow remains.
