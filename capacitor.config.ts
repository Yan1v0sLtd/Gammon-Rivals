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
 *   • `window.location.origin` = `https://gammon-rivals.vercel.app`,
 *     so any auth callback URLs need to be registered with that
 *     origin (already the case for the existing Supabase + Google
 *     OAuth setup).
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
    url: 'https://gammon-rivals.vercel.app',
    // Force the WebView to use https so window.location.origin
    // matches Vercel and Supabase auth redirects stay consistent
    // between web and native.
    androidScheme: 'https',
  },
};

export default config;
