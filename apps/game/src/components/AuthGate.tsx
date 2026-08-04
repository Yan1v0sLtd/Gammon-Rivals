import {type ReactNode, useEffect, useState} from "react"

import {Capacitor} from "@capacitor/core"
import {skipToken} from "@reduxjs/toolkit/query"
import {useLocation} from "react-router-dom"

import {authAnonymousSignInRequested, authGoogleSignInRequested} from "../features/auth/authActions"
import {signInWithPassword} from "../features/auth/authData"
import {selectAuthCommand, selectAuthInitializing, selectAuthUserId} from "../features/auth/authSelectors"
import {useGetProfileQuery, useGetWalletQuery, useGetActiveXpBoostQuery, useGetLevelConfigsQuery, useGetLevelStatusTiersQuery} from "../features/playerData/playerDataApi"
import {isSupabaseConfigured} from "../lib/supabase"
import {useAppDispatch, useAppSelector} from "../store/hooks"

import {LoadingScreen} from "./LoadingScreen"

// Test-user login is gated by two build-time env vars so the button
// renders only on preview / dev builds. Production builds leave both
// vars unset → the button never mounts, never appears in the DOM, and
// the email/password never end up in the prod bundle (Vite tree-shakes
// the dead branch).
const TEST_LOGIN_EMAIL = import.meta.env.VITE_TEST_LOGIN_EMAIL as string | undefined
const TEST_LOGIN_PASSWORD = import.meta.env.VITE_TEST_LOGIN_PASSWORD as string | undefined
const TEST_LOGIN_ENABLED = Boolean(TEST_LOGIN_EMAIL && TEST_LOGIN_PASSWORD)

function isLocalhostOrigin(): boolean {
  return (typeof window !== "undefined" && window.location.hostname === "localhost" && !Capacitor.isNativePlatform())
}

function loopbackUrl(): string {
  return `http://127.0.0.1:${window.location.port}${window.location.pathname}${window.location.search}`
}

function AuthScreen() {
  const location = useLocation()
  const dispatch = useAppDispatch()
  const authCommand = useAppSelector(selectAuthCommand)
  const [busy, setBusy] = useState<"google" | "guest" | "test" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nextPath = `${location.pathname}${location.search}`
  const isSwitchingLocalHost = isLocalhostOrigin()

  useEffect(() => {
    if (!isSwitchingLocalHost) return
    window.location.replace(loopbackUrl())
  }, [isSwitchingLocalHost])

  useEffect(() => {
    if (authCommand.name !== "googleSignIn" && authCommand.name !== "anonymousSignIn") return
    if (authCommand.status === "failed") setError(authCommand.error ?? "Sign-in could not be started.")
    if (authCommand.status !== "pending") setBusy(null)
  }, [authCommand])

  const continueWithGoogle = () => {
    if (isLocalhostOrigin()) {
      window.location.replace(loopbackUrl())
      return
    }
    setBusy("google")
    setError(null)
    const redirectTo = `${window.location.origin}/auth/callback?${new URLSearchParams({
      next: nextPath,
    }).toString()}`
    dispatch(authGoogleSignInRequested({redirectTo}))
  }

  const playAsGuest = () => {
    setBusy("guest")
    setError(null)
    dispatch(authAnonymousSignInRequested())
  }

  // Dev-only login that signs into a pre-created Supabase auth user
  // using email/password from build-time env vars. Lets the operator
  // re-use the SAME account between testing sessions instead of
  // creating a new anonymous guest every reload.
  const loginAsTestUser = async () => {
    if (!TEST_LOGIN_ENABLED) return
    setBusy("test")
    setError(null)
    try {
      await signInWithPassword(TEST_LOGIN_EMAIL!, TEST_LOGIN_PASSWORD!)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBusy(null)
    }
  }

  return (<main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#071120] px-4 text-white">
    <img
      alt=""
      className="absolute inset-0 h-full w-full object-cover opacity-55 blur-sm scale-105"
      draggable={false}
      src="/lobby/backgrounds/classic-green.webp"/>
    <div
      className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(28,127,185,0.32),rgba(5,12,24,0.88)_62%,rgba(2,8,16,0.96))]"/>

    <section
      className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-[#101a2a]/88 p-6 shadow-2xl backdrop-blur-md">
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

      {isSwitchingLocalHost ? (<div
        className="mt-6 rounded-xl border border-[#f4d26e]/35 bg-[#071429]/72 px-5 py-4 text-center text-sm font-bold text-[#f7da7d]">
        Preparing sign-in…
      </div>) : (<div className="mt-6 grid gap-3">
        <button
          className="rounded-xl bg-gradient-to-b from-[#ffffff] to-[#dbe8ff] px-5 py-3 font-display text-lg font-black text-[#16233b] shadow-[0_5px_0_#7a8cac,0_14px_22px_rgba(0,0,0,0.34)] transition hover:brightness-110 active:translate-y-1 active:shadow-[0_2px_0_#7a8cac,0_8px_14px_rgba(0,0,0,0.3)] disabled:opacity-55"
          disabled={!isSupabaseConfigured || busy !== null}
          type="button"
          onClick={continueWithGoogle}>
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <button
          className="rounded-xl border border-[#f4d26e]/75 bg-[#071429]/72 px-5 py-3 font-display text-base font-black text-[#f7da7d] shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_8px_18px_rgba(0,0,0,0.3)] transition hover:bg-[#0d2142] active:translate-y-0.5 disabled:opacity-55"
          disabled={!isSupabaseConfigured || busy !== null}
          type="button"
          onClick={playAsGuest}>
          {busy === "guest" ? "Starting guest…" : "Play as Guest"}
        </button>
        {/* Test login — rendered only when the build has the
                VITE_TEST_LOGIN_EMAIL + VITE_TEST_LOGIN_PASSWORD env
                vars set. Production builds leave them unset → the
                whole branch is tree-shaken out of the bundle. */}
        {TEST_LOGIN_ENABLED && (<button
          className="rounded-xl border border-violet-300/50 bg-violet-900/40 px-5 py-3 font-display text-base font-black text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_8px_18px_rgba(0,0,0,0.3)] transition hover:bg-violet-800/60 active:translate-y-0.5 disabled:opacity-55"
          disabled={!isSupabaseConfigured || busy !== null}
          type="button"
          onClick={loginAsTestUser}>
          {busy === "test" ? "Signing in…" : "Login as Test User"}
        </button>)}
      </div>)}

      {!isSupabaseConfigured && (
        <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-900/25 px-3 py-2 text-xs text-amber-100">
          Supabase is not configured in this environment yet.
        </div>)}
      {error && (
        <div className="mt-4 rounded-lg border border-rose-300/25 bg-rose-950/45 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>)}
    </section>
  </main>)
}

export function AuthGate({children}: {readonly children: ReactNode}) {
  const userId = useAppSelector(selectAuthUserId)
  const authInitializing = useAppSelector(selectAuthInitializing)
  const [hydrationSettled, setHydrationSettled] = useState(!isSupabaseConfigured)
  const profileQuery = useGetProfileQuery(userId ?? skipToken, {skip: !isSupabaseConfigured})
  const walletQuery = useGetWalletQuery(userId ?? skipToken, {skip: !isSupabaseConfigured})
  const xpBoostQuery = useGetActiveXpBoostQuery(userId ?? skipToken, {skip: !isSupabaseConfigured})
  const levelConfigsQuery = useGetLevelConfigsQuery(undefined, {skip: !isSupabaseConfigured})
  const levelStatusTiersQuery = useGetLevelStatusTiersQuery(undefined, {skip: !isSupabaseConfigured})
  const userDataLoading = profileQuery.isLoading || walletQuery.isLoading || xpBoostQuery.isLoading || profileQuery.isUninitialized || walletQuery.isUninitialized || xpBoostQuery.isUninitialized
  useEffect(() => {
    if (!isSupabaseConfigured || authInitializing || levelConfigsQuery.isLoading || levelStatusTiersQuery.isLoading) return
    if (userId !== null && userDataLoading) return
    setHydrationSettled(true)
  }, [authInitializing, levelConfigsQuery.isLoading, levelStatusTiersQuery.isLoading, userId, userDataLoading])
  const isLoading = isSupabaseConfigured && (authInitializing || !hydrationSettled || (userId !== null && userDataLoading))

  if (isLoading) {
    // Same branded loading screen as the Suspense fallback / navigation
    // overlay — this is the FIRST thing a cold app start shows (auth
    // resolving), so the plain "Loading…" text here used to flash before
    // the art appeared.
    return <LoadingScreen/>
  }

  if (!userId) return <AuthScreen/>
  return <>{children}</>
}
