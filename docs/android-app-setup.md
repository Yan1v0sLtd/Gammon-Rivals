# Android App Setup

Gammon Rivals now has a Capacitor Android shell.

## What Is Already Done

- Capacitor is installed.
- The Android project lives in `android/`.
- App name: `Gammon Rivals`
- Android package id: `com.yanivos.gammonrivals`
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

## Daily Commands

Build the web app and copy it into Android:

```bash
npm run android:sync
```

Open the Android project in Android Studio:

```bash
npm run android:open
```

Try a command-line Android build:

```bash
npm run android:debug
```

If the terminal says Java is missing on macOS, use Android Studio's bundled JDK:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npm run android:debug
```

The `android:build` command is reserved for a signed release build and will need
a Play Store keystore later.

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
