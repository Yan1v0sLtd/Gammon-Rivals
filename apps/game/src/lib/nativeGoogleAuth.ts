import {SocialLogin} from '@capgo/capacitor-social-login';
import {isNativePlatform} from './nativeAuth';
import {supabase} from './supabase';

/**
 * Native Google sign-in for the Android (Capacitor) app.
 *
 * Replaces the Custom-Tab / browser OAuth flow (which left the user
 * stranded in a browser tab with chrome after login). Here we use the
 * device's native Google account picker (Android Credential Manager via
 * @capgo/capacitor-social-login) — NO browser tab at all — get a Google
 * ID token, and hand it to Supabase with `signInWithIdToken`. The whole
 * flow stays inside the app, so it looks like a real native app.
 *
 * Config required (one-time, operator side):
 *   1. Google Cloud → an **Android OAuth client** for `com.gammonrivals.app`
 *      with the app's signing SHA-1 (so Google authorizes the request).
 *   2. The **Web OAuth client ID** (the one already configured in the
 *      Supabase Google provider) supplied here as VITE_GOOGLE_WEB_CLIENT_ID.
 *      We request the token for THAT audience so Supabase trusts it.
 */
const WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)?.trim() || undefined;

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!WEB_CLIENT_ID) {
    return Promise.reject(new Error('Google sign-in is not configured on this build: set VITE_GOOGLE_WEB_CLIENT_ID ' + '(the Web OAuth client ID from your Supabase Google provider).'));
  }
  // Initialize the native SDK once. webClientId is the SERVER (Web) OAuth
  // client — the same ID Supabase validates against — so the returned ID
  // token's audience matches and Supabase accepts it.
  initPromise ??= SocialLogin.initialize({google: {webClientId: WEB_CLIENT_ID}});
  return initPromise;
}

export async function signInWithGoogleNative(): Promise<void> {
  if (!isNativePlatform()) {
    throw new Error('signInWithGoogleNative was called off a native platform.');
  }
  await ensureInitialized();

  // Do NOT pass custom `scopes` here. The @capgo plugin's Android
  // GoogleProvider already requests `openid` + `userinfo.email` +
  // `userinfo.profile` by default, and passing ANY custom scope trips its
  // guard: "You CANNOT use scopes without modifying the main activity"
  // (custom scopes force an offline/authorization flow that needs a
  // MainActivity subclass we don't want). The default scopes already put
  // email + basic profile into the returned ID token — all that Supabase's
  // signInWithIdToken needs.
  const response = await SocialLogin.login({
    provider: 'google',
    options: {},
  });

  // Online mode returns { idToken, accessToken, profile }. Cast defensively
  // so we don't fight the plugin's per-provider response union.
  const result = response.result as { idToken?: string | null };
  const idToken = result?.idToken ?? null;
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }

  const {error} = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
}
