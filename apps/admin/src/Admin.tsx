import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {NavLink, Navigate, Route, Routes, useLocation, useNavigate} from "react-router-dom"

// The BO uses its own independent Supabase session (adminSupabase) so
// the operator can be signed in as admin here while the game tab is
// running as a guest or a different account. Aliased to `supabase`
// + `isSupabaseConfigured` so the remaining call sites (the access gate
// and the readiness probe) read the same as the old loader did.
import {buildCurrencyRateMap} from "../../../packages/shared/src/currency"

import {PrimaryButton} from "./components/PrimaryButton"
import {SecondaryButton} from "./components/SecondaryButton"
import {AdminAccessAdmin} from "./features/AdminAccess/AdminAccessAdmin.tsx"
import type {AdminRole} from "./features/AdminAccess/AdminAccessData"
import {BoardThemesAdmin} from "./features/BoardThemes/BoardThemesAdmin.tsx"
import {CurrenciesAdmin} from "./features/Currencies/CurrenciesAdmin.tsx"
import {useGetCurrenciesQuery} from "./features/Currencies/CurrenciesApi"
import {DailyBonusAdmin} from "./features/DailyBonus/DailyBonusAdmin.tsx"
import {MissionsAdmin} from "./features/DailyMissions/MissionsAdmin.tsx"
import {DashboardAdmin} from "./features/Dashboard/DashboardAdmin.tsx"
import {DifficultiesAdmin} from "./features/Difficulties/DifficultiesAdmin.tsx"
import {EconomyGrantsAdmin} from "./features/EconomyGrants/EconomyGrantsAdmin.tsx"
import {HourlyWheelAdmin} from "./features/HourlyWheel/HourlyWheelAdmin.tsx"
import {LevelSystemAdmin} from "./features/LevelSystem/LevelSystemAdmin.tsx"
import {LobbyFeaturesAdmin} from "./features/LobbyFeatures/LobbyFeaturesAdmin.tsx"
import {RTPAnalyticsAdmin} from "./features/RTPAnalytics/RTPAnalyticsAdmin.tsx"
import type {RtpRangeId} from "./features/RTPAnalytics/RTPAnalyticsData"
import {ShopAdmin} from "./features/Shop/ShopAdmin.tsx"
import {UsersAdmin} from "./features/Users/UsersAdmin.tsx"
import {adminSections, type Section} from "./lib/adminSections"
import {adminSupabase as supabase, isAdminSupabaseConfigured as isSupabaseConfigured} from "./lib/adminSupabase"
import {isMissingMigrationError} from "./lib/isMissingMigrationError"
import {normalizeEmail} from "./lib/normalizeEmail"
import {useAdminAuth} from "./lib/useAdminAuth"
import {withRequestTimeout} from "./lib/withRequestTimeout"
import {adminBaseApi} from "./store/baseApi"
import {useAdminDispatch, useAdminSelector} from "./store/hooks"

type AccessState = "checking" | "missing-config" | "migration-missing" | "denied" | "allowed"

const roleOptions: readonly AdminRole[] = ["owner", "admin", "support", "viewer"]

/**
 * RTK Query tags for every admin feature. The global Refresh button
 * invalidates them through the shared adminApi cache so the feature
 * panels get fresh data; the shell itself has no direct section-data
 * reads anymore. Tags whose query has no active subscription aren't
 * refetched at refresh time — RTK Query drops the inactive cached result,
 * so the next component that mounts and
 * subscribes (navigating back to that section) refetches instead of
 * serving the pre-refresh data.
 */
const migratedFeatureTags: Parameters<typeof adminBaseApi.util.invalidateTags>[0] = [
  "Currencies",
  "LobbyFeatures",
  "EconomyGrants",
  "DailyBonus",
  "HourlyWheel",
  "LevelSystem",
  "DailyMissions",
  "Difficulties",
  "BoardThemes",
  "BoardThemesPodiums",
  "BoardThemesLoadingScreens",
  "Dashboard",
  "Users",
  "Shop",
  "StoreSales",
  "StoreConfig",
  "AdminAccess",
]

export function Admin() {
  const adminAuth = useAdminAuth()
  // Map the admin-auth context into the variables the rest of this
  // page expects. `linkGoogleIdentity` is no longer needed (the BO
  // doesn't link Google to a guest — it just signs in fresh).
  const user = adminAuth.user
  const profile = adminAuth.profile
  const isLoading = adminAuth.isLoading
  const signInWithGoogle = adminAuth.signInWithGoogle
  const [accessState, setAccessState] = useState<AccessState>(() => isSupabaseConfigured ? "checking" : "missing-config")
  const [role, setRole] = useState<AdminRole | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const dispatch = useAdminDispatch()
  const activeSection: Section = useMemo(
    () => adminSections.find((section) => location.pathname === `/${section.path}`)?.label ?? "Dashboard",
    [location.pathname])
  // Selected user id lives here (not in the Users feature) because the
  // RTP Analytics deep link writes it before navigating to /users.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  // Keep route UI state here so range and expansion survive section navigation.
  // RTP server data is owned by the feature's RTK Query cache.
  const [rtpRange, setRtpRange] = useState<RtpRangeId>("all")
  const [rtpExpandedTier, setRtpExpandedTier] = useState<string | null>(null)

  const [dataError, setDataError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // The Refresh button shows "Refreshing…" from the click until the
  // refetches it triggered have drained. A requested flag (not isFetching alone) so navigating between
  // sections — which also fires queries — doesn't flicker the label.
  const [refreshing, setRefreshing] = useState(false)
  const refreshRequestedRef = useRef(false)
  // True while any query in the shared adminApi cache has a request in
  // flight (a refetch shows as status "pending" too, so the Refresh
  // button stays disabled until the refetches it triggered drain).
  const isFetching = useAdminSelector((state) => (
    Object.values(state.adminApi.queries).some((query) => query?.status === "pending")
  ))
  useEffect(() => {
    if (refreshRequestedRef.current && !isFetching) {
      refreshRequestedRef.current = false
      setRefreshing(false)
    }
  }, [isFetching])

  const canManage = role === "owner" || role === "admin"
  // Currencies are owned by RTK Query. Eagerly fetched once access is
  // allowed; the query
  // result feeds the shared rate map used by the reward-config panels.
  // The Currencies section itself runs its own query (see CurrenciesAdmin).
  const {
    data: currencies = [],
    error: currenciesError,
  } = useGetCurrenciesQuery(undefined, {skip: accessState !== "allowed"})
  // Currency rate map for $ value columns across the reward configs.
  // Disabled currencies are excluded so the operator can hide a code
  // from $ math without dropping its row (XP isn't priced at all — it's
  // not seeded, so it just returns 0 from the helpers).
  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies])
  const currentUserEmail = normalizeEmail(user?.email ?? "")

  const setError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      setDataError(err.message)
      return
    }
    if (err && typeof err === "object" && "message" in err) {
      setDataError(String((err).message))
      return
    }
    setDataError(String(err))
  }, [])

  // The currencies read is the last parent-level subscription left here
  // (it feeds the shared rate map). Its failure surfaces through the
  // page-level banner: otherwise a failed query falls back to its `= []`
  // default and renders as genuinely-empty data in the reward-config
  // panels. Every other migrated feature reports its own query errors
  // through its onError prop.
  useEffect(() => {
    if (currenciesError) setError(currenciesError)
  }, [currenciesError, setError])

  // want to blank the page back to a "Checking access" placeholder on
  // every transient re-run of this effect — token refreshes, tab
  // visibility resumes, etc. The ref records the userId we last
  // verified for. If the effect re-fires with the same userId, we
  // silently skip the work and keep the existing 'allowed' UI on
  // screen. Only a different user (sign-out, switch account) or the
  // first verification ever shows the placeholder.
  const verifiedAccessForUserRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      queueMicrotask(() => {
        setAccessState("missing-config")
        setRole(null)
      })
      return
    }
    if (isLoading) return
    if (!user) {
      verifiedAccessForUserRef.current = null
      queueMicrotask(() => {
        setAccessState("denied")
        setRole(null)
      })
      return
    }

    // Already verified for this same user — skip the noisy re-check.
    // The effect can re-fire on rare hook-dep churn even with the
    // user?.id dep guard (e.g. when React StrictMode double-invokes
    // in dev, or when adminAuth's value useMemo recomputes around a
    // token refresh). Keep the BO content visible.
    if (verifiedAccessForUserRef.current === user.id) return

    let cancelled = false;
    (async () => {
      await Promise.resolve()
      if (cancelled) return
      setAccessState("checking")
      setDataError(null)

      const {
        data: adminRole,
        error,
      } = await withRequestTimeout(supabase.rpc("get_my_admin_role", {}), "Checking admin access")

      if (cancelled) return
      if (isMissingMigrationError(error)) {
        setAccessState("migration-missing")
        setRole(null)
        return
      }
      if (error) {
        setDataError(error.message)
        setAccessState("denied")
        setRole(null)
        return
      }
      if (!adminRole) {
        setAccessState("denied")
        setRole(null)
        return
      }

      const [profileReadiness, shopReadiness] = await Promise.all([supabase.from("profiles").select("level,xp,is_suspended").limit(1), supabase.from("shop_items").select("id").limit(1)])
      const readinessError = profileReadiness.error ?? shopReadiness.error
      if (cancelled) return
      if (isMissingMigrationError(readinessError)) {
        setAccessState("migration-missing")
        setRole(null)
        return
      }
      if (readinessError) {
        setDataError(readinessError.message)
        setAccessState("denied")
        setRole(null)
        return
      }

      verifiedAccessForUserRef.current = user.id
      setRole(adminRole)
      setAccessState("allowed")
    })()

    return () => {
      cancelled = true
    }
  }, [isLoading, user])

  async function signInToAdmin() {
    setSavingKey("admin-login")
    setDataError(null)
    try {
      // adminAuth.signInWithGoogle owns the canonical /auth/callback
      // redirect — no need to compute it here. The BO session lives
      // in its own storageKey, so the game's session (if any) is
      // untouched by this flow.
      await signInWithGoogle()
    }
    catch (err) {
      setError(err)
      setSavingKey(null)
    }
  }

  if (accessState !== "allowed") {
    const needsGoogleSignIn = accessState === "denied" && (user === null ? true : user.is_anonymous ? true : currentUserEmail.length === 0)
    const title = accessState === "missing-config" ? "Supabase is not configured" : accessState === "migration-missing" ? "Back Office database is not ready" : needsGoogleSignIn ? "Back Office sign-in required" : accessState === "denied" ? "Admin access required" : "Checking admin access"
    const message = accessState === "migration-missing" ? "Apply the latest Back Office migration to add email-based admin access and the required management tables." : needsGoogleSignIn ? "Sign in with Google using an allowlisted admin email to unlock the Back Office." : accessState === "denied" ? "This Google account is not on the Back Office admin email list." : accessState === "missing-config" ? "Add the Supabase URL and publishable key to your local environment to use Back Office." : "One moment while the access check finishes."

    return (<div className="min-h-screen bg-[#061225] text-white">
      <div
        className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-5 text-center">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-amber-200/70">
            Gammon Rivals
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">
            {message}
          </p>
          {accessState === "denied" && isSupabaseConfigured && (<div className="mt-5">
            <PrimaryButton
              disabled={savingKey === "admin-login"}
              onClick={() => void signInToAdmin()}>
              {savingKey === "admin-login" ? "Opening Google…" : user?.is_anonymous ? "Link Google account" : "Continue with Google"}
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

  return (<div className="min-h-screen bg-[#061225] text-white">
    <header className="border-b border-white/10 bg-[#08182f]/90 px-4 py-3 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/75">
            Gammon Rivals
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Back Office</h1>
        </div>
        <div className="text-right text-xs text-white/55">
          <div className="text-sm font-bold text-white">{profile?.display_name ?? user?.email ?? "Admin"}</div>
          <div className="capitalize text-amber-200">{role}</div>
        </div>
      </div>
    </header>

    <div className="grid gap-5 px-4 py-5 lg:px-6 lg:grid-cols-[14rem_1fr]">
      <aside className="rounded-xl border border-white/10 bg-white/[0.045] p-2 lg:sticky lg:top-5 lg:h-fit">
        {adminSections.map((section) => (<NavLink
          key={section.path}
          className={({isActive}) => `mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${isActive ? "bg-amber-300 text-[#1b1202] shadow-lg shadow-amber-900/20" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
          to={`/${section.path}`}>
          {section.label}
        </NavLink>))}
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">
              {activeSection}
            </div>
            <div className="mt-1 text-sm text-white/55">
              {canManage ? "Owner/admin mode" : "Read-only admin role"}
            </div>
          </div>
          <SecondaryButton
            disabled={refreshing}
            onClick={() => {
              // All feature data is RTK Query-owned: refresh = invalidate the
              // feature tags through the shared adminApi cache (refetches
              // mounted queries, drops inactive cached results — they refetch
              // when their section next mounts).
              dispatch(adminBaseApi.util.invalidateTags(migratedFeatureTags))
              refreshRequestedRef.current = true
              setRefreshing(true)
            }}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </SecondaryButton>
        </div>

        {dataError && (
          <div className="mb-4 rounded-lg border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {dataError}
          </div>)}

        <Routes>
          <Route
            index
            element={<Navigate
              replace
              to="/dashboard"/>}/>
          <Route
            element={<DashboardAdmin onError={setError}/>}
            path="dashboard"/>

          <Route
            element={<UsersAdmin
              canManage={canManage}
              currentUserId={user?.id ?? null}
              selectedUserId={selectedUserId}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}
              onSelectedUserIdChange={setSelectedUserId}/>}
            path="users"/>

          <Route
            element={<CurrenciesAdmin
              canManage={canManage}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="currencies"/>

          <Route
            element={<EconomyGrantsAdmin
              canManage={canManage}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="economy-grants"/>

          <Route
            element={<LevelSystemAdmin canManage={canManage}/>}
            path="level-system"/>

          <Route
            element={<DailyBonusAdmin
              canManage={canManage}
              rateMap={rateMap}
              updatedBy={user?.id ?? null}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="daily-bonus"/>

          <Route
            element={<HourlyWheelAdmin canManage={canManage}/>}
            path="hourly-wheel"/>

          <Route
            element={<MissionsAdmin canManage={canManage}/>}
            path="daily-missions"/>

          {/* "Tables / Rooms" (kind='standard') section removed — the lobby only
                surfaces difficulty tiers now (DifficultyModal queries kind='difficulty'),
                so the standard-rooms editor was dead UI. The difficulty editor lives in
                the Difficulties feature; the underlying table_configs data is untouched. */}

          <Route
            element={<DifficultiesAdmin
              canManage={canManage}
              updatedBy={user?.id ?? null}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="difficulties"/>

          <Route
            element={<RTPAnalyticsAdmin
              rtpExpandedTier={rtpExpandedTier}
              rtpRange={rtpRange}
              onOpenUser={(profileId) => {
                setSelectedUserId(profileId)
                void navigate("/users")
              }}
              onSetRtpRange={setRtpRange}
              onToggleTier={(tierId) => {
                setRtpExpandedTier((current) => current === tierId ? null : tierId)
              }}/>}
            path="rtp-analytics"/>

          <Route
            element={<BoardThemesAdmin
              canManage={canManage}
              updatedBy={user?.id ?? null}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="board-themes"/>

          <Route
            element={<LobbyFeaturesAdmin
              canManage={canManage}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="lobby-features"/>

          <Route
            element={<ShopAdmin
              canManage={canManage}
              currentUserId={user?.id ?? null}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="shop"/>

          <Route
            element={<AdminAccessAdmin
              canManage={canManage}
              currentUserEmail={currentUserEmail}
              currentUserId={user?.id ?? null}
              roleOptions={roleOptions}
              onBeforeSave={() => {
                setDataError(null)
              }}
              onError={setError}/>}
            path="admin-access"/>

          <Route
            element={<Navigate
              replace
              to="/dashboard"/>}
            path="*"/>
        </Routes>
      </div>
    </div>
  </div>)
}
