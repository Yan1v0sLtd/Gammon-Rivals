#!/usr/bin/env node
/**
 * Force-stop + relaunch the Android app on the connected device or
 * emulator. Use this after a `git push` once Vercel has finished
 * deploying — the WebView cold-starts and pulls the fresh bundle.
 *
 * No APK rebuild involved — only the WebView restarts. For native
 * config changes, use `npm run android:sync` + `npm run android:build`
 * instead.
 *
 * Why a Node script and not a one-liner in package.json:
 *   • ADB isn't on PATH on Windows; we resolve its absolute path
 *     from ANDROID_HOME / ANDROID_SDK_ROOT.
 *   • Works cross-platform (Windows / macOS / Linux) without bash
 *     vs cmd.exe quoting headaches.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const APP_ID = 'com.gammonrivals.app';
const ACTIVITY = `${APP_ID}/com.gammonrivals.app.MainActivity`;

function findAdb() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    throw new Error(
      'ANDROID_HOME / ANDROID_SDK_ROOT not set. Install Android Studio and re-open your shell, ' +
        'or set the env var manually (typical Windows path: %LOCALAPPDATA%\\Android\\Sdk).'
    );
  }
  const binary = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const adb = join(sdk, 'platform-tools', binary);
  if (!existsSync(adb)) {
    throw new Error(`ADB not found at ${adb}. Install the SDK Platform-Tools via Android Studio's SDK Manager.`);
  }
  return adb;
}

function adb(adbPath, args) {
  return execFileSync(adbPath, args, { stdio: 'inherit' });
}

function main() {
  const adbPath = findAdb();

  console.log(`Force-stopping ${APP_ID}…`);
  try {
    adb(adbPath, ['shell', 'am', 'force-stop', APP_ID]);
  } catch {
    // force-stop returns non-zero if the app wasn't running; not fatal.
  }

  console.log(`Launching ${ACTIVITY}…`);
  adb(adbPath, ['shell', 'am', 'start', '-n', ACTIVITY]);

  console.log('\nDone. The WebView will cold-start and fetch the latest bundle from Vercel.');
}

main();
