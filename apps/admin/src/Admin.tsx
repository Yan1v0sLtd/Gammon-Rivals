import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query/react"
import {NavLink, Navigate, Route, Routes, useLocation, useNavigate} from "react-router-dom"

import {buildCurrencyRateMap} from "../../../packages/shared/src/currency"

import {SecondaryButton} from "./components/SecondaryButton"
import {AdminAccessAdmin} from "./features/AdminAccess/AdminAccessAdmin.tsx"
import {useGetMyAdminAccessQuery} from "./features/AdminAccess/AdminAccessApi"
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
import {normalizeEmail} from "./lib/normalizeEmail"
import {useAdminAuth} from "./lib/useAdminAuth"
import {adminBaseApi} from "./store/baseApi"
import {useAdminDispatch, useAdminSelector} from "./store/hooks"

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
  const {
    user,
    profile,
  } = useAdminAuth()
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

  // AdminAuthGate mounts this shell only for a confirmed admin, so the access
  // entry is already in the cache — this read is the role lookup, not a check.
  const {data: access} = useGetMyAdminAccessQuery(user ? user.id : skipToken)
  const role: AdminRole | null = access?.status === "allowed" ? access.role : null
  const canManage = role === "owner" || role === "admin"
  // Currencies are owned by RTK Query. The query result feeds the shared rate
  // map used by the reward-config panels. The Currencies section itself runs
  // its own query (see CurrenciesAdmin).
  const {
    data: currencies = [],
    error: currenciesError,
  } = useGetCurrenciesQuery()
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
