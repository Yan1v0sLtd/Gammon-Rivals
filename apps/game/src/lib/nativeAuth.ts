/**
 * Native-platform helpers for Supabase OAuth on Android (iOS later).
 * The web flow — navigate the tab to the OAuth URL, Google redirects
 * back to /auth/callback, AuthCallback exchanges the code — breaks in
 * a Capacitor WebView:
 *
 *   1. Google's OAuth endpoint refuses to render inside an embedded
 *      WebView (phishing prevention), so it must open in a real
 *      browser tab.
 *   2. The user then sits in the system browser, not the app, and the
 *      session would be lost.
 *
 * Native flow instead:
 *
 *   A) Open the Supabase OAuth URL in Chrome Custom Tabs
 *      (@capacitor/browser) — a real browser context.
 *   B) Point the OAuth `redirectTo` at our custom-scheme deep link
 *      `gammonrivals://auth/callback`. Supabase MUST have this URL
 *      registered (Dashboard → Authentication → URL Configuration →
 *      Redirect URLs) or it silently falls back to the Site URL and
 *      the deep link never fires.
 *   C) `appUrlOpen` (from @capacitor/app) routes the deep link back
 *      into the app; this handler parses the hash, calls
 *      supabase.auth.setSession, and closes the tab.
 *
 * Web keeps the existing AuthCallback page flow; isNativePlatform()
 * splits the two.
 */
import {Capacitor} from '@capacitor/core';
import {App, type URLOpenListenerEvent} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {supabase} from './supabase';

/** True on Android (and later iOS) when the app runs inside a
 *  Capacitor WebView. False on plain-web builds and in Vite dev. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

/** Deep-link redirect target for OAuth flows on native. Must match
 *  the host in AndroidManifest.xml's intent-filter (which routes
 *  any `<scheme>://auth/...` URL back into our app). */
export const NATIVE_AUTH_CALLBACK_URL = 'gammonrivals://auth/callback';

/**
 * OAuth `redirectTo` per platform: the custom-scheme deep link on
 * native, the caller's web URL on web. The optional `next` path rides
 * the deep link's query string so the completion handler can navigate
 * the user back to where they were (e.g. /profile after linking).
 */
export function pickOAuthRedirectTo(webRedirect: string, next?: string): string {
  if (!isNativePlatform()) return webRedirect;
  if (!next) return NATIVE_AUTH_CALLBACK_URL;
  const params = new URLSearchParams({next});
  return `${NATIVE_AUTH_CALLBACK_URL}?${params.toString()}`;
}

/**
 * Open an OAuth URL in Chrome Custom Tabs (Android). No-op on web —
 * there the caller navigates the current tab directly.
 */
export async function openAuthInBrowser(url: string): Promise<void> {
  if (!isNativePlatform()) return;
  await Browser.open({
    url,
    presentationStyle: 'popover'
  });
}

/**
 * Extract access_token / refresh_token (or an error) from a deep-link
 * URL like gammonrivals://auth/callback#access_token=…&refresh_token=…
 * Checks both fragment and search params so server-mode
 * (response_mode=query) works too.
 */
function tokensFromCallbackUrl(rawUrl: string): {
  access_token?: string; refresh_token?: string; error?: string; error_description?: string;
} {
  // Some deep links aren't fully WHATWG-URL-parseable (missing `://`
  // slash, odd encoding); fall back to manual split + query parse.
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
  }
  catch {
    // Fallback parser if URL ctor rejects the scheme.
    const hashIdx = rawUrl.indexOf('#');
    if (hashIdx >= 0) grabFrom(new URLSearchParams(rawUrl.slice(hashIdx + 1)));
    const qIdx = rawUrl.indexOf('?');
    if (qIdx >= 0) {
      const end = hashIdx >= 0 ? hashIdx : rawUrl.length;
      grabFrom(new URLSearchParams(rawUrl.slice(qIdx + 1, end)));
    }
  }

  return {
    access_token,
    refresh_token,
    error,
    error_description
  };
}

/** Callback for a successful native auth completion (e.g. to navigate
 *  back to a page); receives the `next` path if Supabase echoed it. */
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
 * Wire the global `appUrlOpen` listener once per process (idempotent;
 * called from main.tsx). OAuth deep links land here, install the
 * session, and notify registered completion listeners.
 */
let installed = false;

export async function installNativeAuthHandler(): Promise<void> {
  if (installed) return;
  installed = true;
  if (!isNativePlatform()) return;

  await App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    // Only our auth host matters; ignore other deep links/intents.
    let url: URL;
    try {
      url = new URL(event.url);
    }
    catch {
      // Unparseable URL — bail; nothing useful we can do.
      return;
    }
    if (url.host !== 'auth') return;

    const tokens = tokensFromCallbackUrl(event.url);

    // Surface OAuth errors to the console for now.
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
      }
      catch (err) {
        console.warn('Native auth setSession failed:', err);
      }
    }

    // Dismiss the Chrome Custom Tab — the auth flow is done.
    void Browser.close().catch(() => undefined);

    // Notify listeners, passing any `?next=…` Supabase echoed through.
    const nextPath = url.searchParams.get('next');
    listeners.forEach((listener) => listener({nextPath}));
  });
}
