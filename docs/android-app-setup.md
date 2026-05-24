# Android App Setup

Gammon Rivals now has a Capacitor Android shell.

## What Is Already Done

- Capacitor is installed.
- The Android project lives in `android/`.
- App name: `Gammon Rivals`
- Android package id: `com.gammonrivals.app`
- Web build output is copied into Android with `npm run android:sync`.

## Install First

1. Install Android Studio.
2. Open Android Studio once and let it install:
   - Android SDK
   - Android SDK Platform
   - Android SDK Build-Tools
   - Android Emulator
3. Install or select a JDK. Android Studio usually includes one.
4. Create an Android emulator in Android Studio Device Manager, or connect a physical Android device with USB debugging enabled.

## Daily Dev Workflow — "Vercel for mobile"

The Android app's WebView is configured (in `capacitor.config.ts` via
`server.url`) to load `https://gammon-rivals.vercel.app` directly. So
the day-to-day flow on mobile mirrors the web flow exactly:

```
edit code → git push → Vercel auto-deploys → restart the app on phone → see new code
```

**No APK rebuild needed** for any React / CSS / Supabase / Pixi
change. Just push. The next time the app cold-starts (or you swipe
it away and re-open), it pulls the fresh bundle from Vercel.

### When you DO need a new APK

Rare — only for:

- Adding a native Capacitor plugin (push, billing, biometrics, …)
- Changing native config (app icon, splash, app name, deep-link
  scheme)
- Shipping to Play Store (comment out `server.url`, `cap sync`
  bundles `dist/` into the APK so it works offline + passes review)

### Commands

Rebuild the APK after a native change:

```bash
npm run android:sync        # build web + copy capacitor.config + plugins into android/
cd android && ./gradlew.bat assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

Open Android Studio:

```bash
npm run android:open
```

If the terminal says Java is missing on Windows, use Android Studio's
bundled JBR:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
```

(macOS equivalent: `/Applications/Android Studio.app/Contents/jbr/Contents/Home`)

### Installing on a device / emulator

```bash
# Replace $ADB with C:/Users/Yaniv/AppData/Local/Android/Sdk/platform-tools/adb.exe
adb devices                                                                       # list connected devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk                 # install (or replace) the APK
adb shell am start -n com.gammonrivals.app/com.gammonrivals.app.MainActivity     # launch (or just tap the icon)
adb logcat | grep Capacitor                                                       # tail logs to verify it's loading from Vercel
```

The `android:build` command is reserved for a signed release build
and will need a Play Store keystore later (Phase 6).

## First Android Studio Run

1. Run `npm run android:sync`.
2. Run `npm run android:open`.
3. Wait for Android Studio Gradle sync to finish.
4. Choose an emulator or connected device.
5. Press Run.

## Next Product Work

- Fix native mobile layout issues found on emulator/device.
- Configure native auth redirect handling for Supabase.
- Add production app icons and splash screens.
- Create a signed Android App Bundle (`.aab`) for Play Console internal testing.
- Add Google Play Billing before selling coins, gems, bundles, boards, or cosmetics in the app.
