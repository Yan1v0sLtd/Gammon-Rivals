import {type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import type {Session} from "@supabase/supabase-js"

import {adminBaseApi} from "../store/baseApi"
import {useAdminDispatch} from "../store/hooks"

import {AdminAuthContext} from "./adminAuthContext"
import type {AdminAuthContextValue, ProfileRow} from "./adminAuthTypes"
import {adminSupabase, isAdminSupabaseConfigured} from "./adminSupabase"

const missingConfigMessage = "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use the back office."

export function AdminAuthProvider({children}: {children: ReactNode}) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [isLoading, setIsLoading] = useState(isAdminSupabaseConfigured)
  const dispatch = useAdminDispatch()

  const fetchProfile = useCallback(async (userId: string) => {
    if (!isAdminSupabaseConfigured) return
    const profileRes = await adminSupabase.from("profiles").select("*").eq("id", userId).maybeSingle()
    if (profileRes.error) {
      console.warn("admin profile fetch error", profileRes.error)
    }
    setProfile(profileRes.data ?? null)
  }, [])

  useEffect(() => {
    if (!isAdminSupabaseConfigured) return
    let cancelled = false
    // Remember the last userId we fetched the profile for so token
    // refreshes (which fire onAuthStateChange with a fresh session
    // object but the same user) don't trigger a noisy refetch.
    // Without this guard, every TOKEN_REFRESHED event re-ran
    // fetchProfile, causing extra renders downstream.
    let lastFetchedUserId: string | null = null;
    (async () => {
      const {data} = await adminSupabase.auth.getSession()
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        await fetchProfile(data.session.user.id)
        lastFetchedUserId = data.session.user.id
      }
      if (cancelled) return
      setIsLoading(false)
    })()

    const {data: sub} = adminSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      const nextUserId = s?.user?.id ?? null
      // The identity changed (sign-out, or a sign-in as anybody): every cached
      // admin result belongs to the previous operator, the access check
      // included, so a re-auth as the same account must re-run the check
      // instead of serving its own stale "allowed". Guarding on a known
      // previous user keeps the boot events (INITIAL_SESSION / SIGNED_IN) from
      // resetting a cache that is still filling; a TOKEN_REFRESHED event keeps
      // the same id and so changes nothing.
      if (lastFetchedUserId && lastFetchedUserId !== nextUserId) {
        dispatch(adminBaseApi.util.resetApiState())
      }
      if (nextUserId && nextUserId !== lastFetchedUserId) {
        lastFetchedUserId = nextUserId
        void fetchProfile(nextUserId)
      }
      else if (!nextUserId) {
        lastFetchedUserId = null
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [fetchProfile, dispatch])

  const signInWithGoogle = useCallback(async () => {
    if (!isAdminSupabaseConfigured) throw new Error(missingConfigMessage)
    const redirectTo = `${window.location.origin}/admin/auth/callback`
    const {
      data,
      error,
    } = await adminSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {prompt: "select_account"},
        skipBrowserRedirect: true,
      },
    })
    if (error) throw error
    if (!data.url) throw new Error("Google sign-in did not return a redirect URL.")
    window.location.assign(data.url)
  }, [])

  const signOut = useCallback(async () => {
    if (!isAdminSupabaseConfigured) return
    await adminSupabase.auth.signOut()
  }, [])

  const refresh = useCallback(async () => {
    if (!session?.user) return
    await fetchProfile(session.user.id)
  }, [session, fetchProfile])

  const value = useMemo<AdminAuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isLoading,
    signInWithGoogle,
    signOut,
    refresh,
  }), [session, profile, isLoading, signInWithGoogle, signOut, refresh])

  // The explicit provider form preserves the existing context API.
  // eslint-disable-next-line @eslint-react/no-context-provider
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}
