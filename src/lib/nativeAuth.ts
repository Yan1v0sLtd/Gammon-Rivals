/**
 * Native-platform helpers for Supabase OAuth flows on Android (and
 * iOS later). On the web we lean on Supabase's built-in flow:
 * `signInWithOAuth` returns a URL, we navigate the current tab to
 * it, Google redirects back to `/auth/callback`, the AuthCallback
 * page exchanges the code for a session. None of that works in a
 * Capacitor WebView because:
 *
 *   1. Google's OAuth endpoint refuses to render inside an embedded
 *      WebView (security policy — phishing prevention). We have to
 *      open it in a real browser tab.
 *   2. After Google redirects to Supabase and Supabase redirects to
 *      `https://gammon-rivals.vercel.app/auth/callback`, the user
 *      is in the system browser, not the app. We'd lose the
 *      session.
 *
 * The native flow this module enables:
 *
 *   A) Open the Supabase-generated OAuth URL in Chrome Custom Tabs
 *      via @capacitor/browser. That's a real browser context, so
 *      Google is happy.
 *   B) Configure the OAuth `redirectTo` to be our custom-scheme
 *      deep link: `gammonrivals://auth/callback`. Supabase MUST
 *      have this URL registered in
 *      Dashboard → Authentication → URL Configuration → Redirect
 *      URLs. Without the dashboard entry Supabase silently swaps
 *      back to the project's Site URL and the deep link never fires.
 *   C) Listen for the `appUrlOpen` event from @capacitor/app. When
 *      the OS routes `gammonrivals://auth/callback#access_token=…`
 *      back into MainActivity, this handler parses the hash and
 *      calls `supabase.auth.setSession` to install the session in
 *      the JS layer. Then closes the Chrome Custom Tab.
 *
 * The web build still uses the existing AuthCallback page flow.
 * Platform detection (`isNativePlatform`) is what splits the two.
 */
import { Capacitor } from '@capacitor/core';
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

/** True on Android (and later iOS) when the app runs inside a
 *  Capacitor WebView. False on plain-web builds and in Vite dev. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

/** Deep-link redirect target for OAuth flows on native. Must match
 *  the host in AndroidManifest.xml's intent-filter (which routes
 *  any `<scheme>://auth/...` URL back into our app). */
export const NATIVE_AUTH_CALLBACK_URL = 'gammonrivals://auth/callback';

/**
 * Pick the right OAuth `redirectTo` based on platform:
 *   - Native (Android/iOS) → custom-scheme deep link.
 *   - Web                  → the caller's web URL (unchanged behaviour).
 *
 * The optional `next` path is appended to the deep link as a query
 * param so the JS handler can navigate the user to the right place
 * after the session is installed (e.g. back to /profile after a
 * guest → Google link from the profile page).
 */
export function pickOAuthRedirectTo(webRedirect: string, next?: string): string {
  if (!isNativePlatform()) return webRedirect;
  if (!next) return NATIVE_AUTH_CALLBACK_URL;
  const params = new URLSearchParams({ next });
  return `${NATIVE_AUTH_CALLBACK_URL}?${params.toString()}`;
}

/**
 * Open an OAuth URL in a real browser tab (Chrome Custom Tabs on
 * Android). On web this is a no-op because the calling code uses
 * `window.location.assign` directly — the web flow stays within
 * one browser context, so we don't need to spawn a new tab.
 */
export async function openAuthInBrowser(url: string): Promise<void> {
  if (!isNativePlatform()) return;
  await Browser.open({ url, presentationStyle: 'popover' });
}

/**
 * Extract { access_token, refresh_token } from a deep-link URL like
 *   gammonrivals://auth/callback#access_token=AAA&refresh_token=BBB&…
 * Both fragments and search params are checked so server-mode
 * (`response_mode=query`) ALSO works, even though Supabase uses
 * the fragment by default.
 */
function tokensFromCallbackUrl(rawUrl: string): {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
} {
  // Some deep links the OS passes us are not fully WHATWG-URL-parseable
  // (e.g. a missing `://` slash, or odd encoding). Be defensive: split
  // on the first `#`, parse the back half as a query string.
  let access_token: string | undefined;
  let refresh_token: string | undefined;
  let error: string | undefined;
  let error_description: string | undefined;

  const grabFrom = (sp: URLSearchParams) => {
    access_token ??= sp.get('access_token') ?? undefined;
    refresh_token ??= sp.get('refresh_token') ?? undefined;
    error ??= sp.get('error') ?? undefined;
    error_description ??= sp.get('error_description') ?? undefined;
  };

  try {
    const url = new URL(rawUrl);
    if (url.hash.length > 1) grabFrom(new URLSearchParams(url.hash.slice(1)));
    if (url.search.length > 1) grabFrom(new URLSearchParams(url.search.slice(1)));
  } catch {
    // Fallback parser if URL ctor rejects the scheme.
    const hashIdx = rawUrl.indexOf('#');
    if (hashIdx >= 0) grabFrom(new URLSearchParams(rawUrl.slice(hashIdx + 1)));
    const qIdx = rawUrl.indexOf('?');
    if (qIdx >= 0) {
      const end = hashIdx >= 0 ? hashIdx : rawUrl.length;
      grabFrom(new URLSearchParams(rawUrl.slice(qIdx + 1, end)));
    }
  }

  return { access_token, refresh_token, error, error_description };
}

/** Optional callback the host app can register so it can react to a
 *  successful native auth completion (e.g. navigate back to a page,
 *  show a toast). Receives the parsed `next` path if Supabase
 *  echoed our `?next=…` query param through the redirect. */
export interface NativeAuthCompletionPayload {
  readonly nextPath: string | null;
}
type NativeAuthCompletionListener = (payload: NativeAuthCompletionPayload) => void;
const listeners = new Set<NativeAuthCompletionListener>();

export function onNativeAuthCompletion(listener: NativeAuthCompletionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install the global `appUrlOpen` listener exactly once per process.
 * Called from main.tsx at startup. Safe to call multiple times —
 * the guard ensures only the first call wires the listener.
 *
 * Subsequent OAuth deep links land here, install the session, and
 * notify any registered completion listeners.
 */
let installed = false;
export async function installNativeAuthHandler(): Promise<void> {
  if (installed) return;
  installed = true;
  if (!isNativePlatform()) return;

  await App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    // We only care about URLs landing on our auth host. Ignore
    // anything else (e.g. share intents, future deep links into
    // other sections of the app).
    let url: URL | null = null;
    try {
      url = new URL(event.url);
    } catch {
      // Unparseable URL — bail; nothing useful we can do.
      return;
    }
    if (url.host !== 'auth') return;

    const tokens = tokensFromCallbackUrl(event.url);

    // Surface OAuth errors as console output for now — a future
    // pass can show a toast in the lobby.
    if (tokens.error) {
      console.warn('Native auth callback error:', tokens.error, tokens.error_description);
      void Browser.close().catch(() => undefined);
      return;
    }

    if (tokens.access_token && tokens.refresh_token) {
      try {
        await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
      } catch (err) {
        console.warn('Native auth setSession failed:', err);
      }
    }

    // Dismiss the Chrome Custom Tab — the auth flow is done.
    void Browser.close().catch(() => undefined);

    // Notify listeners. `?next=…` may have been carried through by
    // Supabase as a query param on the deep link URL.
    const nextPath = url.searchParams.get('next');
    listeners.forEach((listener) => listener({ nextPath }));
  });
}
