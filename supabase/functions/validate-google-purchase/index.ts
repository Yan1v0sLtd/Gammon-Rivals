// P2 — Google Play purchase validation edge function.
//
// The native app (cordova-plugin-purchase) gets a purchase token from Play, then
// POSTs it here with the buyer's Supabase JWT. We:
//   1. verify the JWT -> profile_id (the buyer is who they say; can't fulfill for
//      someone else, since the id comes from the token, not the body),
//   2. resolve the shop item -> its google_product_id (Play SKU),
//   3. verify the token with Google's Play Developer API (purchaseState == 0),
//   4. call fulfill_google_purchase (service_role, idempotent) -> grant,
//   5. return { status, wallet }.
//
// The client acknowledges/consumes the purchase via the plugin's finish() AFTER
// we return 'granted' (cordova-plugin-purchase's model), so we don't acknowledge
// here. Refunds/chargebacks are handled later by P4 (Real-time Developer
// Notifications), not this function.
//
// DEPLOY: `supabase functions deploy validate-google-purchase` once the secrets
// exist. Required secrets (set with `supabase secrets set ...`):
//   • GOOGLE_SERVICE_ACCOUNT_JSON  — the Play Developer API service-account key
//     (the whole JSON). NEVER commit it; the repo is public.
//   • ANDROID_PACKAGE_NAME         — defaults to com.gammonrivals.app.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected
// automatically by the Edge runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PACKAGE_NAME = Deno.env.get('ANDROID_PACKAGE_NAME') ?? 'com.gammonrivals.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Google service-account OAuth (RS256 JWT → access token) ─────────────────
function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getGoogleAccessToken(): Promise<string> {
  const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!saRaw) throw new Error('billing_not_configured');
  const sa = JSON.parse(saRaw) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`google_oauth_failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// purchaseState: 0 = purchased, 1 = cancelled, 2 = pending.
async function verifyPurchase(accessToken: string, productId: string, token: string): Promise<boolean> {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}` +
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return false;
  const data = await res.json() as { purchaseState?: number };
  return data.purchaseState === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'not_authenticated' }, 401);

    const { shopItemId, purchaseToken } = await req.json() as {
      shopItemId?: string;
      purchaseToken?: string;
    };
    if (!shopItemId || !purchaseToken) return json({ error: 'missing_args' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Verify the buyer from their JWT.
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: 'not_authenticated' }, 401);
    const profileId = userData.user.id;

    const admin = createClient(url, serviceKey);

    // Resolve the item's Play SKU.
    const { data: item, error: itemErr } = await admin
      .from('shop_items')
      .select('id, google_product_id')
      .eq('id', shopItemId)
      .single();
    if (itemErr || !item?.google_product_id) return json({ error: 'item_not_found' }, 404);

    // Verify the token with Google.
    let valid = false;
    try {
      const accessToken = await getGoogleAccessToken();
      valid = await verifyPurchase(accessToken, item.google_product_id, purchaseToken);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'billing_not_configured') return json({ error: 'billing_not_configured' }, 503);
      return json({ error: 'validation_failed', detail: msg }, 502);
    }
    if (!valid) return json({ status: 'invalid' }, 200);

    // Grant (idempotent, service_role-only).
    const { data: result, error: grantErr } = await admin.rpc('fulfill_google_purchase', {
      p_profile_id: profileId,
      p_item_id: shopItemId,
      p_purchase_token: purchaseToken,
    });
    if (grantErr) return json({ error: 'grant_failed', detail: grantErr.message }, 500);

    return json(result);
  } catch (e) {
    return json({ error: 'unexpected', detail: (e as Error).message }, 500);
  }
});
