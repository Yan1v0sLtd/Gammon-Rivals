import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config.
 *
 * `webDir: 'dist/play'` is the self-contained source bundled into the native
 * shell: `pnpm run android:sync` rebuilds the game into `dist/play` and syncs
 * it into `android/`. No remote `server.url` live reload is configured — it is
 * intentionally disabled because the game is Capacitor-only and `/play` is not
 * web-served, so there is nothing to load from the web.
 *
 * Any React / CSS / Supabase / Pixi change requires a rebuild + sync (`pnpm run
 * android:sync`) and a rebuild/reinstall of the APK (or a Run from Android
 * Studio).
 */
const config: CapacitorConfig = {
  appId: 'com.gammonrivals.app',
  appName: 'Gammon Rivals',
  webDir: 'dist/play',
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
