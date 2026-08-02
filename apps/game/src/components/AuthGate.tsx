import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { LoadingScreen } from './LoadingScreen';

// Test-user login is gated by two build-time env vars so the button
// renders only on preview / dev builds. Production builds leave both
// vars unset → the button never mounts, never appears in the DOM, and
// the email/password never end up in the prod bundle (Vite tree-shakes
// the dead branch).
const TEST_LOGIN_EMAIL = import.meta.env.VITE_TEST_LOGIN_EMAIL as string | undefined;
const TEST_LOGIN_PASSWORD = import.meta.env.VITE_TEST_LOGIN_PASSWORD as string | undefined;
const TEST_LOGIN_ENABLED = Boolean(TEST_LOGIN_EMAIL && TEST_LOGIN_PASSWORD);

function isLocalhostOrigin(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost' &&
    !Capacitor.isNativePlatform()
  );
}

function loopbackUrl(): string {
  return `http://127.0.0.1:${window.location.port}${window.location.pathname}${window.location.search}`;
}

function AuthScreen() {
  const location = useLocation();
  const { signInWithGoogle, signInAnonymously } = useAuth();
  const [busy, setBusy] = useState<'google' | 'guest' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextPath = `${location.pathname}${location.search}`;
  const isSwitchingLocalHost = isLocalhostOrigin();

  useEffect(() => {
    if (!isSwitchingLocalHost) return;
    window.location.replace(loopbackUrl());
  }, [isSwitchingLocalHost]);

  const continueWithGoogle = async () => {
    if (isLocalhostOrigin()) {
      window.location.replace(loopbackUrl());
      return;
    }
    setBusy('google');
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?${new URLSearchParams({
        next: nextPath,
      }).toString()}`;
      await signInWithGoogle({ redirectTo });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const playAsGuest = async () => {
    setBusy('guest');
    setError(null);
    try {
      await signInAnonymously();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Dev-only login that signs into a pre-created Supabase auth user
  // using email/password from build-time env vars. Lets the operator
  // re-use the SAME account between testing sessions instead of
  // creating a new anonymous guest every reload.
  const loginAsTestUser = async () => {
    if (!TEST_LOGIN_ENABLED) return;
    setBusy('test');
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: TEST_LOGIN_EMAIL!,
        password: TEST_LOGIN_PASSWORD!,
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#071120] px-4 text-white">
      <img
        src="/lobby/backgrounds/classic-green.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-55 blur-sm scale-105"
        draggable={false}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(28,127,185,0.32),rgba(5,12,24,0.88)_62%,rgba(2,8,16,0.96))]" />

      <section className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-[#101a2a]/88 p-6 shadow-2xl backdrop-blur-md">
        <div className="text-center">
          <div className="font-display text-xs font-black uppercase tracking-[0.42em] text-[#f6d770]">
            Gammon Rivals
          </div>
          <h1 className="mt-4 font-display text-3xl font-black text-white">
            Save your progress
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/72">
            Sign in with Google to keep your boards, coins, level, and match history across devices.
            Guest mode is still available for quick play.
          </p>
        </div>

        {isSwitchingLocalHost ? (
          <div className="mt-6 rounded-xl border border-[#f4d26e]/35 bg-[#071429]/72 px-5 py-4 text-center text-sm font-bold text-[#f7da7d]">
            Preparing sign-in…
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={!isSupabaseConfigured || busy !== null}
              className="rounded-xl bg-gradient-to-b from-[#ffffff] to-[#dbe8ff] px-5 py-3 font-display text-lg font-black text-[#16233b] shadow-[0_5px_0_#7a8cac,0_14px_22px_rgba(0,0,0,0.34)] transition hover:brightness-110 active:translate-y-1 active:shadow-[0_2px_0_#7a8cac,0_8px_14px_rgba(0,0,0,0.3)] disabled:opacity-55"
            >
              {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <button
              type="button"
              onClick={playAsGuest}
              disabled={!isSupabaseConfigured || busy !== null}
              className="rounded-xl border border-[#f4d26e]/75 bg-[#071429]/72 px-5 py-3 font-display text-base font-black text-[#f7da7d] shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_8px_18px_rgba(0,0,0,0.3)] transition hover:bg-[#0d2142] active:translate-y-0.5 disabled:opacity-55"
            >
              {busy === 'guest' ? 'Starting guest…' : 'Play as Guest'}
            </button>
            {/* Test login — rendered only when the build has the
                VITE_TEST_LOGIN_EMAIL + VITE_TEST_LOGIN_PASSWORD env
                vars set. Production builds leave them unset → the
                whole branch is tree-shaken out of the bundle. */}
            {TEST_LOGIN_ENABLED && (
              <button
                type="button"
                onClick={loginAsTestUser}
                disabled={!isSupabaseConfigured || busy !== null}
                className="rounded-xl border border-violet-300/50 bg-violet-900/40 px-5 py-3 font-display text-base font-black text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_8px_18px_rgba(0,0,0,0.3)] transition hover:bg-violet-800/60 active:translate-y-0.5 disabled:opacity-55"
              >
                {busy === 'test' ? 'Signing in…' : 'Login as Test User'}
              </button>
            )}
          </div>
        )}

        {!isSupabaseConfigured && (
          <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-900/25 px-3 py-2 text-xs text-amber-100">
            Supabase is not configured in this environment yet.
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-rose-300/25 bg-rose-950/45 px-3 py-2 text-xs text-rose-100">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}

export default function AuthGate({ children }: { readonly children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    // Same branded loading screen as the Suspense fallback / navigation
    // overlay — this is the FIRST thing a cold app start shows (auth
    // resolving), so the plain "Loading…" text here used to flash before
    // the art appeared.
    return <LoadingScreen />;
  }

  if (!user) return <AuthScreen />;
  return <>{children}</>;
}
