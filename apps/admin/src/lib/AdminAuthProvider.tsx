import {type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import type {Session} from "@supabase/supabase-js"

import {AdminAuthContext} from "./adminAuthContext"
import type {AdminAuthContextValue, AdminRole, ProfileRow} from "./adminAuthTypes"
import {adminSupabase, isAdminSupabaseConfigured} from "./adminSupabase"

const missingConfigMessage = "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use the back office."

export function AdminAuthProvider({children}: {children: ReactNode}) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)
  const [isLoading, setIsLoading] = useState(isAdminSupabaseConfigured)

  const fetchProfileAndRole = useCallback(async (userId: string) => {
    if (!isAdminSupabaseConfigured) return
    const [profileRes, roleRes] = await Promise.all([adminSupabase.from("profiles").select("*").eq("id", userId).maybeSingle(), adminSupabase.from("admin_roles").select("role").eq("profile_id", userId).maybeSingle()])
    if (profileRes.error) {
      console.warn("admin profile fetch error", profileRes.error)
    }
    setProfile(profileRes.data ?? null)
    setRole((roleRes.data?.role) ?? null)
  }, [])

  useEffect(() => {
    if (!isAdminSupabaseConfigured) return
    let cancelled = false
    // Remember the last userId we fetched profile/role for so token
    // refreshes (which fire onAuthStateChange with a fresh session
    // object but the same user) don't trigger a noisy refetch.
    // Without this guard, every TOKEN_REFRESHED event re-ran
    // fetchProfileAndRole, causing extra renders downstream that
    // could chain into Admin.tsx flipping back to its access-check
    // placeholder.
    let lastFetchedUserId: string | null = null;
    (async () => {
      const {data} = await adminSupabase.auth.getSession()
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        await fetchProfileAndRole(data.session.user.id)
        lastFetchedUserId = data.session.user.id
      }
      if (cancelled) return
      setIsLoading(false)
    })()

    const {data: sub} = adminSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      const nextUserId = s?.user?.id ?? null
      if (nextUserId && nextUserId !== lastFetchedUserId) {
        lastFetchedUserId = nextUserId
        void fetchProfileAndRole(nextUserId)
      }
      else if (!nextUserId) {
        lastFetchedUserId = null
        setProfile(null)
        setRole(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [fetchProfileAndRole])

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
    await fetchProfileAndRole(session.user.id)
  }, [session, fetchProfileAndRole])

  const value = useMemo<AdminAuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    role,
    isLoading,
    canManage: role === "owner" || role === "admin",
    isReady: !isLoading,
    signInWithGoogle,
    signOut,
    refresh,
  }), [session, profile, role, isLoading, signInWithGoogle, signOut, refresh])

  // The explicit provider form preserves the existing context API.
  // eslint-disable-next-line @eslint-react/no-context-provider
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}
