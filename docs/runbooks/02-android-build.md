# Android Build

> Status: live · Last verified: 2026-08-10 · Owner: developer

## Purpose

Build, sync, and install the Capacitor Android shell for Gammon Rivals.

## Prerequisites

1. Install Android Studio.
2. Open Android Studio once and let it install:
   - Android SDK
   - Android SDK Platform
   - Android SDK Build-Tools
   - Android Emulator
3. Install or select a JDK. Android Studio usually includes one.
4. Create an Android emulator in Android Studio Device Manager, or connect a
   physical Android device with USB debugging enabled.

## Steps

The game is bundled into the native shell, not loaded from the web.
`capacitor.config.ts` sets `webDir: 'dist/play'` and does not configure a remote
`server.url` — `/play` no longer exists on the public website, so the old
"Vercel-for-mobile" live-reload workflow is dead.

The day-to-day flow is a bundle + sync cycle:

```text
edit code → pnpm run android:sync → rebuild/reinstall (or Run from Android Studio) → see new code
```

**Every React / CSS / Supabase / Pixi change requires a bundle/APK refresh.**
`pnpm run android:sync` rebuilds the game into `dist/play` and syncs it into the
`android/` project; the APK must then be rebuilt and reinstalled (or re-run from
Android Studio). There is no push-and-reload shortcut anymore.

A new APK is also needed for:

- Adding a native Capacitor plugin (push, billing, biometrics, ...)
- Changing native config (app icon, splash, app name, deep-link scheme)
- Shipping to Play Store — release builds use the self-contained `dist/play`
  bundle (already what `webDir` points at), so the APK works offline and passes
  review

Rebuild the APK after a native change:

```bash
pnpm run android:sync        # build web + copy capacitor.config + plugins into android/
cd android && ./gradlew.bat assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

Open Android Studio:

```bash
pnpm run android:open
```

If the terminal says Java is missing on Windows, use Android Studio's bundled
JBR:

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
adb logcat | grep Capacitor                                                       # tail logs to verify the app is running
```

The `android:build` command is reserved for a signed release build and will need
a Play Store keystore later (Phase 6).

## Verification

- The app launches on the device or emulator.
- `adb logcat | grep Capacitor` shows the app running.

## Troubleshooting

- If Gradle sync fails, wait for it to finish before running.
- If Java is missing, set `JAVA_HOME` to the Android Studio bundled JBR (above).

## Related documents

- `docs/runbooks/03-play-billing-release.md` — release AAB and Play Billing.
