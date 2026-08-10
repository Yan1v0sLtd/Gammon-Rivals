import {type ReactNode, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query/react"

import {PrimaryButton} from "../../components/PrimaryButton"
import {isAdminSupabaseConfigured} from "../../lib/adminSupabase"
import {normalizeEmail} from "../../lib/normalizeEmail"
import {useAdminAuth} from "../../lib/useAdminAuth"

import {useGetMyAdminAccessQuery} from "./AdminAccessApi"
import styles from "./AdminAuthGate.module.css"

type AccessState = "checking" | "missing-config" | "migration-missing" | "denied" | "allowed"

/**
 * Guards the Back Office shell: it renders `children` only for an operator the
 * server confirmed as an admin, and owns every not-allowed screen. Mounted
 * around the lazy shell in App.tsx, so the shell's hooks and queries never run
 * during the access check.
 */
export function AdminAuthGate({children}: {
  children: ReactNode,
}) {
  const {
    user,
    isLoading,
    signInWithGoogle,
  } = useAdminAuth()
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const {
    data: access,
    error: accessError,
  } = useGetMyAdminAccessQuery(!isAdminSupabaseConfigured || isLoading || !user ? skipToken : user.id)

  const currentUserEmail = normalizeEmail(user?.email ?? "")
  // `access` survives a refetch, so a token refresh keeps the shell mounted
  // instead of flashing the "Checking access" placeholder.
  const accessState: AccessState = !isAdminSupabaseConfigured ? "missing-config" : accessError ? "denied" : access ? access.status : isLoading || user ? "checking" : "denied"

  if (accessState === "allowed") return <>{children}</>

  const errorMessage = signInError ?? accessError?.message ?? null
  const needsGoogleSignIn = accessState === "denied" && (user === null ? true : user.is_anonymous ? true : currentUserEmail.length === 0)
  const title = accessState === "missing-config" ? "Supabase is not configured" : accessState === "migration-missing" ? "Back Office database is not ready" : needsGoogleSignIn ? "Back Office sign-in required" : accessState === "denied" ? "Admin access required" : "Checking admin access"
  const message = accessState === "migration-missing" ? "Apply the latest Back Office migration to add email-based admin access and the required management tables." : needsGoogleSignIn ? "Sign in with Google using an allowlisted admin email to unlock the Back Office." : accessState === "denied" ? "This Google account is not on the Back Office admin email list." : accessState === "missing-config" ? "Add the Supabase URL and publishable key to your local environment to use Back Office." : "One moment while the access check finishes."

  async function signInToAdmin() {
    setSigningIn(true)
    setSignInError(null)
    try {
      // signInWithGoogle owns the canonical /auth/callback redirect. The BO
      // session lives in its own storageKey, so the game's session (if any) is
      // untouched by this flow.
      await signInWithGoogle()
    }
    catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err))
      setSigningIn(false)
    }
  }

  return (<div className={styles.shell}>
    <div className={styles.center}>
      <div className={styles.card}>
        <div className={styles.brandLabel}>
          Gammon Rivals
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>
          {message}
        </p>
        {errorMessage && (
          <div className={styles.errorBanner}>
            {errorMessage}
          </div>)}
        {accessState === "denied" && isAdminSupabaseConfigured && (<div className={styles.signInRow}>
          <PrimaryButton
            disabled={signingIn}
            onClick={() => void signInToAdmin()}>
            {signingIn ? "Opening Google…" : user?.is_anonymous ? "Link Google account" : "Continue with Google"}
          </PrimaryButton>
        </div>)}
        {user && accessState !== "checking" && (
          <div className={styles.sessionBox}>
            <div>
              <div className={styles.sessionLabel}>Current email</div>
              <div className={styles.sessionValue}>{user.email ?? "No verified email"}</div>
            </div>
            <div>
              <div className={styles.sessionLabel}>Current profile id</div>
              <div className={styles.sessionValue}>{user.id}</div>
            </div>
          </div>)}
      </div>
    </div>
  </div>)
}
