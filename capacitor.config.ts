import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config.
 *
 * `server.url` is set to the Vercel production deployment so the
 * Android WebView loads the LIVE site rather than the bundled
 * `dist/` folder. This gives us a "Vercel-for-mobile" workflow:
 * any `git push` → Vercel auto-deploys → restart the app on the
 * phone → new code is live, with no APK rebuild needed.
 *
 * The APK is just a thin native shell. We only rebuild + reinstall
 * it when we:
 *   • Add a native Capacitor plugin (push, billing, biometrics, …)
 *   • Change native config (icon, splash, app name, deep links)
 *   • Ship to Play Store (which needs a self-contained bundle —
 *     we flip `server.url` off and `cap sync` bundles dist/ inside
 *     the APK for review)
 *
 * Caveats while `server.url` is set:
 *   • Internet required at app launch (WebView fetches from Vercel)
 *   • `window.location.origin` = `https://gammonrivals.com`, so any
 *     auth callback URLs need to be registered with that origin
 *     (already the case for the existing Supabase + Google OAuth
 *     setup).
 *   • The URL points at `/play`, NOT the apex. Post-cutover the apex
 *     (`/`) serves the public "Coming Soon" marketing landing — the
 *     native app must boot straight into the game lobby instead.
 *
 * Switching back to bundled mode for Play Store later: comment out
 * the `server` block, leave `webDir`, and `cap sync` will package
 * the latest `dist/` into the APK.
 */
const config: CapacitorConfig = {
  appId: 'com.gammonrivals.app',
  appName: 'Gammon Rivals',
  webDir: 'dist',
  server: {
    // Production canonical domain, pointed at /play. The apex (/) now
    // serves the public "Coming Soon" marketing landing after the
    // domain cutover, so the native app must launch into the game
    // lobby directly — otherwise the WebView shows the landing page
    // instead of the game.
    url: 'https://gammonrivals.com/play',
    // Force the WebView to use https so window.location.origin
    // matches Vercel and Supabase auth redirects stay consistent
    // between web and native.
    androidScheme: 'https',
  },
  plugins: {
    // @capgo/capacitor-social-login defaults to bundling ALL providers
    // (Google, Facebook, Apple, Twitter). We only do Google sign-in, so
    // disable the rest — otherwise their native SDKs get pulled in and
    // would demand their own config (Facebook app id, etc.) and bloat /
    // break the Android build.
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
