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

import styles from "./AuthGate.module.css"
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

  return (<div className={styles.authShell}>
    <img
      alt=""
      className={styles.authBackdrop}
      draggable={false}
      src="/lobby/backgrounds/classic-green.webp"/>
    <div className={styles.authOverlay}/>

    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authBrand}>
          Gammon Rivals
        </div>
        <h1 className={styles.authTitle}>
          Save your progress
        </h1>
        <p className={styles.authSubtitle}>
          Sign in with Google to keep your boards, coins, level, and match history across devices.
          Guest mode is still available for quick play.
        </p>
      </div>

      {isSwitchingLocalHost ? (<div className={styles.authNotice}>
        Preparing sign-in…
      </div>) : (<div className={styles.authButtons}>
        <button
          className={styles.authButtonGoogle}
          disabled={!isSupabaseConfigured || busy !== null}
          type="button"
          onClick={continueWithGoogle}>
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <button
          className={styles.authButtonGuest}
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
          className={styles.authButtonTest}
          disabled={!isSupabaseConfigured || busy !== null}
          type="button"
          onClick={loginAsTestUser}>
          {busy === "test" ? "Signing in…" : "Login as Test User"}
        </button>)}
      </div>)}

      {!isSupabaseConfigured && (
        <div className={styles.authWarning}>
          Supabase is not configured in this environment yet.
        </div>)}
      {error && (
        <div className={styles.authError}>
          {error}
        </div>)}
    </div>
  </div>)
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
