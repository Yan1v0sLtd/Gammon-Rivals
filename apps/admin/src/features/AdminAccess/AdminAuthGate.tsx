import {type ReactNode, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query/react"

import {PrimaryButton} from "../../components/PrimaryButton"
import {isAdminSupabaseConfigured} from "../../lib/adminSupabase"
import {normalizeEmail} from "../../lib/normalizeEmail"
import {useAdminAuth} from "../../lib/useAdminAuth"

import {useGetMyAdminAccessQuery} from "./AdminAccessApi"

type AccessState = "checking" | "missing-config" | "migration-missing" | "denied" | "allowed"

/**
 * Guards the Back Office shell: it renders `children` only for an operator the
 * server confirmed as an admin, and owns every not-allowed screen. Mounted
 * around the lazy shell in App.tsx, so the shell's hooks and queries never run
 * during the access check.
 */
export function AdminAuthGate({children}: {children: ReactNode}) {
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
  const accessState: AccessState = !isAdminSupabaseConfigured
    ? "missing-config"
    : accessError
      ? "denied"
      : access
        ? access.status
        : isLoading || user
          ? "checking"
          : "denied"

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

  return (<div className="min-h-screen bg-[#061225] text-white">
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-5 text-center">
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
        <div className="text-xs font-bold uppercase tracking-[0.28em] text-amber-200/70">
          Gammon Rivals
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          {message}
        </p>
        {errorMessage && (
          <div className="mt-4 rounded-lg border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {errorMessage}
          </div>)}
        {accessState === "denied" && isAdminSupabaseConfigured && (<div className="mt-5">
          <PrimaryButton
            disabled={signingIn}
            onClick={() => void signInToAdmin()}>
            {signingIn ? "Opening Google…" : user?.is_anonymous ? "Link Google account" : "Continue with Google"}
          </PrimaryButton>
        </div>)}
        {user && accessState !== "checking" && (
          <div className="mt-4 space-y-2 rounded-lg bg-black/25 px-3 py-2 text-left text-xs text-white/55">
            <div>
              <div className="text-white/35">Current email</div>
              <div className="mt-1 break-all font-mono text-amber-100">{user.email ?? "No verified email"}</div>
            </div>
            <div>
              <div className="text-white/35">Current profile id</div>
              <div className="mt-1 break-all font-mono text-amber-100">{user.id}</div>
            </div>
          </div>)}
      </div>
    </div>
  </div>)
}
