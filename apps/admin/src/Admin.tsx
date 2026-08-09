import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {NavLink, Navigate, Route, Routes, useLocation, useNavigate} from "react-router-dom"

// The BO uses its own independent Supabase session (adminSupabase) so
// the operator can be signed in as admin here while the game tab is
// running as a guest or a different account. Aliased to `supabase`
// + `isSupabaseConfigured` so the rest of the file (30+ call sites)
// keeps working unchanged.
import {buildCurrencyRateMap} from "../../../packages/shared/src/currency"
import type {Database} from "../../../packages/shared/src/database"

import {PrimaryButton} from "./components/PrimaryButton"
import {SecondaryButton} from "./components/SecondaryButton"
import {useConfirm} from "./components/useConfirm"
import {AdminAccessAdmin} from "./features/AdminAccess/AdminAccessAdmin.tsx"
import {BoardThemesAdmin} from "./features/BoardThemes/BoardThemesAdmin.tsx"
import {CurrenciesAdmin} from "./features/Currencies/CurrenciesAdmin.tsx"
import {useGetCurrenciesQuery, useUpsertCurrencyMutation} from "./features/Currencies/CurrenciesApi"
import {DailyBonusAdmin} from "./features/DailyBonus/DailyBonusAdmin.tsx"
import {MissionsAdmin} from "./features/DailyMissions/MissionsAdmin.tsx"
import {DashboardAdmin} from "./features/Dashboard/DashboardAdmin.tsx"
import {DifficultiesAdmin} from "./features/Difficulties/DifficultiesAdmin.tsx"
import {EconomyGrantsAdmin} from "./features/EconomyGrants/EconomyGrantsAdmin.tsx"
import {HourlyWheelAdmin} from "./features/HourlyWheel/HourlyWheelAdmin.tsx"
import {LevelSystemAdmin} from "./features/LevelSystem/LevelSystemAdmin.tsx"
import {LobbyFeaturesAdmin} from "./features/LobbyFeatures/LobbyFeaturesAdmin.tsx"
import {RTPAnalyticsAdmin} from "./features/RTPAnalytics/RTPAnalyticsAdmin.tsx"
import {ShopAdmin} from "./features/Shop/ShopAdmin.tsx"
import {UsersAdmin} from "./features/Users/UsersAdmin.tsx"
import {accountType} from "./lib/accountType"
import {adminSections, type Section} from "./lib/adminSections"
import {adminSupabase as supabase, isAdminSupabaseConfigured as isSupabaseConfigured} from "./lib/adminSupabase"
import {boardToDraft, type BoardDraft} from "./lib/boardToDraft"
import {currencyToDraft, type CurrencyDraft} from "./lib/currencyToDraft"
import {dailyBonusToDraft, type DailyBonusDraft} from "./lib/dailyBonusToDraft"
import {emptyToNull} from "./lib/emptyToNull"
import {formatNumber} from "./lib/formatNumber"
import {grantToDraft, type EconomyGrantDraft} from "./lib/grantToDraft"
import {isDeletedProfile} from "./lib/isDeletedProfile"
import {isMissingAnyColumnError} from "./lib/isMissingAnyColumnError"
import {isMissingColumnError} from "./lib/isMissingColumnError"
import {isMissingMigrationError} from "./lib/isMissingMigrationError"
import {isPolicyError} from "./lib/isPolicyError"
import {levelToDraft, type LevelDraft} from "./lib/levelToDraft"
import {normalizeEmail} from "./lib/normalizeEmail"
import {numberOrNull} from "./lib/numberOrNull"
import {parseJson} from "./lib/parseJson"
import {requiredNumber} from "./lib/requiredNumber"
import {shopToDraft, type ShopDraft} from "./lib/shopToDraft"
import {tableToDraft, type TableDraft} from "./lib/tableToDraft"
import {useAdminAuth} from "./lib/useAdminAuth"
import {useOnlineUsersWatcher} from "./lib/useOnlineUsersWatcher"
import {withGameplayBackgroundMetadata} from "./lib/withGameplayBackgroundMetadata"
import {withRequestTimeout} from "./lib/withRequestTimeout"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
type AdminRoleRow = Database["public"]["Tables"]["admin_roles"]["Row"]
type AdminEmailRoleRow = Database["public"]["Tables"]["admin_email_allowlist"]["Row"]
type AdminRole = AdminRoleRow["role"]
type LevelConfig = Database["public"]["Tables"]["level_configs"]["Row"]
type LevelStatusTier = Database["public"]["Tables"]["level_status_tiers"]["Row"]
/**
 * Editable per-row state for the Status Tiers panel. We keep `id`
 * nullable so a brand-new row (not yet inserted) can sit alongside
 * existing ones in the same draft array. All numeric fields are
 * stored as strings so the inputs can be empty mid-edit without
 * blanking the form state.
 */
type LevelStatusTierDraft = {
  id: string | null, level_from: string, level_to: string, label: string, sort_order: string, is_enabled: boolean,
}
/**
 * Number of rows shown at once in the Levels table. The curve can
 * easily hit 100+ levels, so we paginate to keep the BO scrollable.
 * 'all' is the escape hatch for spreadsheet-style scanning.
 */
type LevelsPageSize = 25 | 50 | 100 | "all"
type EconomyGrant = Database["public"]["Tables"]["economy_grants"]["Row"]
type DailyBonusConfig = Database["public"]["Tables"]["daily_bonus_configs"]["Row"]
type TableConfig = Database["public"]["Tables"]["table_configs"]["Row"]
type BoardThemeConfig = Database["public"]["Tables"]["board_theme_configs"]["Row"]
type PodiumImage = Database["public"]["Tables"]["podium_images"]["Row"]
type LoadingScreenImage = Database["public"]["Tables"]["loading_screen_images"]["Row"]
type AuditEntry = Database["public"]["Tables"]["admin_audit_log"]["Row"]
type UserWallet = Database["public"]["Tables"]["user_wallets"]["Row"]
type WalletTransaction = Database["public"]["Tables"]["wallet_transactions"]["Row"]
type UserBoardInventory = Database["public"]["Tables"]["user_board_inventory"]["Row"]
type Purchase = Database["public"]["Tables"]["purchases"]["Row"]
type ShopItem = Database["public"]["Tables"]["shop_items"]["Row"]

type AccessState = "checking" | "missing-config" | "migration-missing" | "denied" | "allowed"

type AdminStats = {
  users: number,
  matches: number,
  activeMatches: number,
  configItems: number,
  shopItems: number,
  suspendedUsers: number,
}

type AdminUser = {
  wallet?: UserWallet,
} & ProfileRow

type UserDetail = {
  wallet: UserWallet | null,
  transactions: WalletTransaction[],
  boards: UserBoardInventory[],
  purchases: Purchase[],
  matches: Database["public"]["Tables"]["matches"]["Row"][],
}

/**
 * Time-range presets for the RTP dashboard. `since` is the actual
 * timestamp (relative to "now" at click time) that we send to the
 * get_rtp_summary RPC. null = all time.
 */
const RTP_RANGES: readonly {id: string, label: string, hours: number | null}[] = [{
  id: "24h",
  label: "Last 24h",
  hours: 24,
}, {
  id: "7d",
  label: "Last 7d",
  hours: 24 * 7,
}, {
  id: "30d",
  label: "Last 30d",
  hours: 24 * 30,
}, {
  id: "all",
  label: "All time",
  hours: null,
}]

/**
 * Shape returned by public.get_rtp_summary. Column names are prefixed
 * with `out_` server-side to dodge an OUT-parameter / table-column
 * naming collision in plpgsql — that prefix is what the client sees,
 * so it's preserved here. See migration 20260604_rtp_summary_rpc.sql.
 */
type RtpRow = {
  out_table_config_id: string,
  out_display_name: string,
  out_target_rtp_pct: number,
  out_matches_played: number,
  out_matches_won: number,
  out_actual_win_rate_pct: number | null,
  out_coins_wagered: number,
  out_coins_paid_out: number,
  out_coins_house_net: number,
  out_actual_rtp_pct: number | null,
  out_rtp_delta_pct: number | null,
  out_risk_free_count: number,
}

type RtpPerPlayerRow = {
  out_profile_id: string,
  out_display_name: string,
  out_matches_played: number,
  out_matches_won: number,
  out_win_rate_pct: number | null,
  out_coins_wagered: number,
  out_coins_paid_out: number,
  out_coins_house_net: number,
  out_actual_rtp_pct: number | null,
}

/** Accent slugs the DifficultyModal recognises. The BO dropdown is
 *  scoped to these so an operator can't accidentally set an unknown
 *  slug and ship a card with no colour. */
const difficultyAccentColors: readonly string[] = ["green", "blue", "purple", "red", "gold"]

const roleOptions: readonly AdminRole[] = ["owner", "admin", "support", "viewer"]

const builtInBoardSeeds: readonly Database["public"]["Tables"]["board_theme_configs"]["Insert"][] = [{
  id: "classic-green",
  display_name: "Classic Green",
  preview_image: "/lobby/board-previews/classic-green.webp",
  gameplay_image: "/themes/classic-green/board.webp",
  lobby_background_image: "/lobby/backgrounds/classic-green.webp",
  unlock_level: 1,
  price_coins: 0,
  is_enabled: true,
  is_featured: true,
  sort_order: 10,
  metadata: {
    accent: "#6dda72",
    subtitle: "Traditional felt",
    gameplayBackgroundImage: "/lobby/backgrounds/classic-green.webp",
  },
}, {
  id: "ocean-blue",
  display_name: "Ocean Blue",
  preview_image: "/lobby/board-previews/ocean-blue.webp",
  gameplay_image: "/themes/ocean-blue/board.webp",
  lobby_background_image: "/lobby/backgrounds/ocean-blue.webp",
  unlock_level: 5,
  price_coins: 1500,
  is_enabled: true,
  is_featured: false,
  sort_order: 20,
  metadata: {
    accent: "#39d7ff",
    subtitle: "Bright coastal wood",
    gameplayBackgroundImage: "/lobby/backgrounds/ocean-blue.webp",
  },
}, {
  id: "royal-purple",
  display_name: "Royal Purple",
  preview_image: "/lobby/board-previews/royal-purple.webp",
  gameplay_image: "/themes/royal-purple/board.webp",
  lobby_background_image: "/lobby/backgrounds/royal-purple.webp",
  unlock_level: 10,
  price_coins: 5000,
  is_enabled: true,
  is_featured: false,
  sort_order: 30,
  metadata: {
    accent: "#c174ff",
    subtitle: "Gold tournament trim",
    gameplayBackgroundImage: "/lobby/backgrounds/royal-purple.webp",
  },
}]

const initialStats: AdminStats = {
  users: 0,
  matches: 0,
  activeMatches: 0,
  configItems: 0,
  shopItems: 0,
  suspendedUsers: 0,
}

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
  const activeSection: Section = useMemo(
    () => adminSections.find((section) => location.pathname === `/${section.path}`)?.label ?? "Dashboard",
    [location.pathname])
  const [stats, setStats] = useState<AdminStats>(initialStats)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [checkedUserIds, setCheckedUserIds] = useState<Set<string>>(() => new Set())
  const [selectedUserDetail, setSelectedUserDetail] = useState<UserDetail | null>(null)
  const [userSearch, setUserSearch] = useState("")
  const [profileDraft, setProfileDraft] = useState({
    level: "1",
    xp: "0",
    rating: "1500",
    admin_note: "",
    suspension_reason: "",
  })
  const [walletDraft, setWalletDraft] = useState({
    currency: "coins",
    amount: "",
    reason: "",
  })
  const [levels, setLevels] = useState<LevelConfig[]>([])
  const [economyGrants, setEconomyGrants] = useState<EconomyGrant[]>([])
  const [grantDraft, setGrantDraft] = useState<EconomyGrantDraft>(() => grantToDraft())
  // Bottom-nav feature lock levels (lobby_feature_configs). `level` is kept as
  // a string for the text input; saved as an integer. `tooltip` is the
  // optional override copy ("" → default "Reach level N to unlock").
  const [lobbyFeatures, setLobbyFeatures] = useState<{
    feature_key: string, label: string, level: string, enabled: boolean, tooltip: string,
  }[]>([])
  const [levelStatusTiers, setLevelStatusTiers] = useState<LevelStatusTier[]>([])
  const [tierDrafts, setTierDrafts] = useState<LevelStatusTierDraft[]>([])
  const [levelsPageSize, setLevelsPageSize] = useState<LevelsPageSize>(50)
  const [levelsPageIndex, setLevelsPageIndex] = useState(0)
  const [savingTiers, setSavingTiers] = useState(false)
  const [tierError, setTierError] = useState<string | null>(null)
  const [tierMessage, setTierMessage] = useState<string | null>(null)
  const [dailyBonusConfigs, setDailyBonusConfigs] = useState<DailyBonusConfig[]>([])
  const [tables, setTables] = useState<TableConfig[]>([])
  const [boards, setBoards] = useState<BoardThemeConfig[]>([])
  const [podiums, setPodiums] = useState<PodiumImage[]>([])
  const [podiumDraft, setPodiumDraft] = useState<{name: string, image_url: string}>({
    name: "",
    image_url: "",
  })
  const [loadingScreens, setLoadingScreens] = useState<LoadingScreenImage[]>([])
  const [loadingScreenDraft, setLoadingScreenDraft] = useState<{name: string, image_url: string}>({
    name: "",
    image_url: "",
  })
  const [shopItems, setShopItems] = useState<ShopItem[]>([])
  // Store Sale draft — one global, schedulable promo that boosts coin/gem
  // grants. Numeric/date fields are strings so inputs can be cleared mid-edit.
  const [saleDraft, setSaleDraft] = useState<{
    id: string | null, label: string, bonus_percent: string, is_active: boolean, starts_at: string, ends_at: string,
  }>({
    id: null,
    label: "Store Sale",
    bonus_percent: "0",
    is_active: false,
    starts_at: "",
    ends_at: "",
  })
  // Storefront presentation (singleton store_config): the shop popup's header
  // title + an optional blurred themed background. Independent of the sale.
  const [storeConfigDraft, setStoreConfigDraft] = useState<{title: string, bg_image_url: string}>({
    title: "Store",
    bg_image_url: "",
  })
  const [audit, setAudit] = useState<AuditEntry[]>([])
  // RTP dashboard state — fetched lazily when the section is opened so
  // we don't pay the aggregation cost on every BO load.
  const [rtpRange, setRtpRange] = useState<string>("all")
  const [rtpRows, setRtpRows] = useState<RtpRow[]>([])
  const [rtpLoading, setRtpLoading] = useState(false)
  const [rtpError, setRtpError] = useState<string | null>(null)
  // The currently-expanded tier (per-player drill-down). Null = no
  // tier expanded. Players list is cached per (tier, range) — switching
  // back to an expanded tier shows last-known data instantly while a
  // fresh fetch runs in the background.
  const [rtpExpandedTier, setRtpExpandedTier] = useState<string | null>(null)
  const [rtpPlayerRows, setRtpPlayerRows] = useState<RtpPerPlayerRow[]>([])
  const [rtpPlayerLoading, setRtpPlayerLoading] = useState(false)
  const [rtpPlayerError, setRtpPlayerError] = useState<string | null>(null)

  // Live online users — subscribes to the shared `online-users`
  // Realtime presence channel that the game app's auth listener
  // joins (features/auth/authListeners.ts). Only active while
  // the operator is on the Users section so the WebSocket isn't kept
  // open BO-wide.
  const onlineUsers = useOnlineUsersWatcher(activeSection === "Users")
  const [adminRoles, setAdminRoles] = useState<AdminRoleRow[]>([])
  const [adminEmailRoles, setAdminEmailRoles] = useState<AdminEmailRoleRow[]>([])
  const [roleDraft, setRoleDraft] = useState({
    profile_id: "",
    role: "viewer" as AdminRole,
    note: "",
  })
  const [emailRoleDraft, setEmailRoleDraft] = useState({
    email: "contact@yanivos.com",
    role: "owner" as AdminRole,
    note: "Initial owner email",
  })
  const [levelDraft, setLevelDraft] = useState<LevelDraft>(() => levelToDraft())
  const [dailyBonusDraft, setDailyBonusDraft] = useState<DailyBonusDraft>(() => dailyBonusToDraft())
  const [tableDraft, setTableDraft] = useState<TableDraft>(() => tableToDraft())
  const [boardDraft, setBoardDraft] = useState<BoardDraft>(() => boardToDraft())
  const [boardEditorOpen, setBoardEditorOpen] = useState(false)
  const [boardEditorMode, setBoardEditorMode] = useState<"add" | "edit">("add")
  const [shopDraft, setShopDraft] = useState<ShopDraft>(() => shopToDraft())
  const [currencyDraft, setCurrencyDraft] = useState<CurrencyDraft>(() => currencyToDraft())
  const [dataError, setDataError] = useState<string | null>(null)
  const [boardMessage, setBoardMessage] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // Non-blocking confirm/prompt dialogs (replaces window.confirm/prompt, which
  // freeze the main thread and trip the INP monitor). Render {confirmUI} once.
  const {
    confirm,
    prompt,
    confirmUI,
  } = useConfirm()

  const canManage = role === "owner" || role === "admin"
  const selectedUser = users.find((row) => row.id === selectedUserId) ?? null
  // Currencies are owned by RTK Query. Eagerly fetched once access is
  // allowed (mirroring the old initial loadAdminData fetch); the query
  // result feeds the rate map and the CurrenciesAdmin list.
  const {
    data: currencies = [],
    error: currenciesError,
  } = useGetCurrenciesQuery(undefined, {skip: accessState !== "allowed"})
  const [upsertCurrency] = useUpsertCurrencyMutation()
  // Currency rate map for $ value columns across the reward configs.
  // Disabled currencies are excluded so the operator can hide a code
  // from $ math without dropping its row (XP isn't priced at all — it's
  // not seeded, so it just returns 0 from the helpers).
  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies])
  const currentUserEmail = normalizeEmail(user?.email ?? "")
  const selectedEmailRole = adminEmailRoles.find((row) => row.email === normalizeEmail(emailRoleDraft.email)) ?? null

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

  // Surface a currencies query failure through the page-level dataError.
  // Only sets when there's an error so it never clears unrelated errors.
  useEffect(() => {
    if (currenciesError) setError(currenciesError)
  }, [currenciesError, setError])

  async function loadBoardConfigs(successMessage?: string) {
    const {
      data,
      error,
    } = await withRequestTimeout(supabase.from("board_theme_configs").select("*").order("sort_order", {ascending: true}), "Loading board themes")
    if (error) throw error

    const nextBoards = data ?? []
    setBoards(nextBoards)
    setStats((current) => ({
      ...current,
      configItems: levels.length + tables.length + nextBoards.length,
    }))
    if (successMessage) setBoardMessage(successMessage)
  }

  // Podium library (the stand the board sits on in the lobby carousel).
  // Loaded on demand when the Board Themes section opens (see effect
  // below) rather than in the big initial load, to keep that batch lean.
  const loadPodiums = useCallback(async (successMessage?: string) => {
    const {
      data,
      error,
    } = await withRequestTimeout(supabase
      .from("podium_images")
      .select("*")
      .order("sort_order", {ascending: false})
      .order("created_at", {ascending: false}), "Loading podiums")
    if (error) throw error
    setPodiums(data ?? [])
    if (successMessage) setBoardMessage(successMessage)
  }, [])

  async function addPodium() {
    if (!canManage) return
    const image_url = podiumDraft.image_url.trim()
    if (!image_url) {
      setDataError("Upload or paste a podium image first.")
      return
    }
    setSavingKey("podium-add")
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase
        .from("podium_images")
        .insert({
          name: podiumDraft.name.trim() || "Podium",
          image_url,
          updated_by: user?.id ?? null,
        })
        .select("id"), "Adding podium")
      if (error) throw error
      setPodiumDraft({
        name: "",
        image_url: "",
      })
      await loadPodiums("Podium added.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function activatePodium(podium: PodiumImage) {
    if (!canManage || podium.is_active) return
    setSavingKey(`podium-active-${podium.id}`)
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase.rpc("set_active_podium", {p_id: podium.id}), "Activating podium")
      if (error) throw error
      await loadPodiums("Podium activated.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deletePodium(podium: PodiumImage) {
    if (!canManage) return
    if (podium.is_active) {
      setDataError("Set another podium active before deleting the active one.")
      return
    }
    const confirmed = await confirm({
      title: `Delete podium "${podium.name}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    setSavingKey(`podium-delete-${podium.id}`)
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase.from("podium_images").delete().eq("id", podium.id).select("id"), "Deleting podium")
      if (error) throw error
      await loadPodiums("Podium deleted.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  // Loading-screen library (the full-art cover shown while the app loads).
  // Same model as the podium: many rows, exactly one active.
  const loadLoadingScreens = useCallback(async (successMessage?: string) => {
    const {
      data,
      error,
    } = await withRequestTimeout(supabase
      .from("loading_screen_images")
      .select("*")
      .order("sort_order", {ascending: false})
      .order("created_at", {ascending: false}), "Loading loading screens")
    if (error) throw error
    setLoadingScreens(data ?? [])
    if (successMessage) setBoardMessage(successMessage)
  }, [])

  async function addLoadingScreen() {
    if (!canManage) return
    const image_url = loadingScreenDraft.image_url.trim()
    if (!image_url) {
      setDataError("Upload or paste a loading-screen image first.")
      return
    }
    setSavingKey("loading-screen-add")
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase
        .from("loading_screen_images")
        .insert({
          name: loadingScreenDraft.name.trim() || "Loading screen",
          image_url,
          updated_by: user?.id ?? null,
        })
        .select("id"), "Adding loading screen")
      if (error) throw error
      setLoadingScreenDraft({
        name: "",
        image_url: "",
      })
      await loadLoadingScreens("Loading screen added.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function activateLoadingScreen(screen: LoadingScreenImage) {
    if (!canManage || screen.is_active) return
    setSavingKey(`loading-screen-active-${screen.id}`)
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase.rpc("set_active_loading_screen", {p_id: screen.id}), "Activating loading screen")
      if (error) throw error
      await loadLoadingScreens("Loading screen activated.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deleteLoadingScreen(screen: LoadingScreenImage) {
    if (!canManage) return
    if (screen.is_active) {
      setDataError("Set another loading screen active before deleting the active one.")
      return
    }
    const confirmed = await confirm({
      title: `Delete loading screen "${screen.name}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    setSavingKey(`loading-screen-delete-${screen.id}`)
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase.from("loading_screen_images").delete().eq("id", screen.id).select("id"), "Deleting loading screen")
      if (error) throw error
      await loadLoadingScreens("Loading screen deleted.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  // Load the podium + loading-screen libraries when the operator opens
  // Board Themes (both panels live in that section).
  useEffect(() => {
    if (activeSection !== "Board Themes") return
    void loadPodiums().catch(setError)
    void loadLoadingScreens().catch(setError)
  }, [activeSection, loadPodiums, loadLoadingScreens, setError])

  // Load bottom-nav feature lock levels when the operator opens Lobby Features.
  useEffect(() => {
    if (activeSection !== "Lobby Features") return
    void supabase
      .from("lobby_feature_configs")
      .select("feature_key, label, unlock_level, is_enabled, sort_order, tooltip_text")
      .order("sort_order", {ascending: true})
      .then(({
        data,
        error,
      }) => {
        if (error) {
          setError(error)
          return
        }
        setLobbyFeatures((data ?? []).map((r) => ({
          feature_key: r.feature_key,
          label: r.label,
          level: String(r.unlock_level),
          enabled: r.is_enabled,
          tooltip: r.tooltip_text ?? "",
        })))
      })
  }, [activeSection, setError])

  // Once we've verified the signed-in admin's access once, we don't
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

  const loadSelectedUser = useCallback(async (profileId: string) => {
    try {
      const [wallet, transactions, boardsOwned, purchases, matches] = await Promise.all([supabase.from("user_wallets").select("*").eq("profile_id", profileId).maybeSingle(), supabase
        .from("wallet_transactions")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", {ascending: false})
        .limit(12), supabase
        .from("user_board_inventory")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", {ascending: false}), supabase
        .from("purchases")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", {ascending: false})
        .limit(12), supabase
        .from("matches")
        .select("*")
        .or(`owner_id.eq.${profileId},opponent_id.eq.${profileId}`)
        .order("started_at", {ascending: false})
        .limit(12)])

      const firstError = wallet.error ?? transactions.error ?? boardsOwned.error ?? purchases.error ?? matches.error
      if (firstError) throw firstError

      setSelectedUserDetail({
        wallet: wallet.data,
        transactions: transactions.data ?? [],
        boards: boardsOwned.data ?? [],
        purchases: purchases.data ?? [],
        matches: matches.data ?? [],
      })
    }
    catch (err) {
      setError(err)
    }
  }, [setError])

  const loadAdminData = useCallback(async () => {
    if (accessState !== "allowed") return
    setRefreshing(true)
    setDataError(null)

    try {
      const [userCount, suspendedCount, matchCount, activeMatchCount, profilesResult, levelResult, levelStatusTierResult, economyGrantResult, dailyBonusResult, tableResult, boardResult, shopResult, auditResult, roleResult, emailRoleResult] = await Promise.all([supabase.from("profiles").select("id", {
        count: "exact",
        head: true,
      }), supabase
        .from("profiles")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("is_suspended", true), supabase.from("matches").select("id", {
        count: "exact",
        head: true,
      }), supabase.from("matches").select("id", {
        count: "exact",
        head: true,
      }).is("finished_at", null), supabase
        .from("profiles")
        .select("*")
        .order("created_at", {ascending: false})
        .limit(120), supabase.from("level_configs").select("*").order("level", {ascending: true}), supabase
        .from("level_status_tiers")
        .select("*")
        .order("sort_order", {ascending: true})
        .order("level_from", {ascending: true}), supabase
        .from("economy_grants")
        .select("*")
        .order("sort_order", {ascending: true})
        .order("trigger_key", {ascending: true}), supabase.from("daily_bonus_configs").select("*").order("day", {ascending: true}), supabase.from("table_configs").select("*").order("sort_order", {ascending: true}), supabase.from("board_theme_configs").select("*").order("sort_order", {ascending: true}), supabase.from("shop_items").select("*").order("sort_order", {ascending: true}), supabase.from("admin_audit_log").select("*").order("created_at", {ascending: false}).limit(20), supabase.from("admin_roles").select("*").order("created_at", {ascending: false}), supabase.from("admin_email_allowlist").select("*").order("created_at", {ascending: false})])

      const firstError = userCount.error ?? suspendedCount.error ?? matchCount.error ?? activeMatchCount.error ?? profilesResult.error ?? levelResult.error ?? levelStatusTierResult.error ?? economyGrantResult.error ?? dailyBonusResult.error ?? tableResult.error ?? boardResult.error ?? shopResult.error ?? auditResult.error ?? roleResult.error ?? emailRoleResult.error
      if (firstError) throw firstError

      const profileRows = (profilesResult.data ?? []).filter((row) => !isDeletedProfile(row))
      const profileIds = profileRows.map((row) => row.id)
      const wallets = profileIds.length ? await supabase.from("user_wallets").select("*").in("profile_id", profileIds) : {
        data: [],
        error: null,
      }
      if (wallets.error) throw wallets.error

      const walletMap = new Map((wallets.data ?? []).map((wallet) => [wallet.profile_id, wallet]))
      const adminUsers = profileRows.map((row) => ({
        ...row,
        wallet: walletMap.get(row.id),
      }))

      setUsers(adminUsers)
      setCheckedUserIds((current) => {
        const visibleIds = new Set(adminUsers.map((row) => row.id))
        return new Set([...current].filter((id) => visibleIds.has(id)))
      })
      setLevels(levelResult.data ?? [])
      setEconomyGrants(economyGrantResult.data ?? [])
      const tierRows = levelStatusTierResult.data ?? []
      setLevelStatusTiers(tierRows)
      // Initialize the editable drafts from the freshly loaded rows.
      // String-ify numerics so the inputs can be cleared without
      // losing form state.
      setTierDrafts(tierRows.map((t) => ({
        id: t.id,
        level_from: String(t.level_from),
        level_to: String(t.level_to),
        label: t.label,
        sort_order: String(t.sort_order),
        is_enabled: t.is_enabled,
      })))
      setDailyBonusConfigs(dailyBonusResult.data ?? [])
      setTables(tableResult.data ?? [])
      setBoards(boardResult.data ?? [])
      setShopItems(shopResult.data ?? [])
      // Store Sale (single global row). Loaded here so a save refreshes it too.
      const saleResult = await supabase
        .from("store_sales")
        .select("*")
        .order("updated_at", {ascending: false})
        .limit(1)
        .maybeSingle()
      if (!saleResult.error && saleResult.data) {
        const s = saleResult.data
        setSaleDraft({
          id: s.id,
          label: s.label,
          bonus_percent: String(s.bonus_percent),
          is_active: s.is_active,
          starts_at: s.starts_at?.slice(0, 16) ?? "",
          ends_at: s.ends_at?.slice(0, 16) ?? "",
        })
      }
      // Storefront presentation (singleton, seeded on migrate — always one row).
      const storeConfigResult = await supabase
        .from("store_config")
        .select("title, bg_image_url")
        .eq("id", true)
        .maybeSingle()
      if (!storeConfigResult.error && storeConfigResult.data) {
        setStoreConfigDraft({
          title: storeConfigResult.data.title ?? "Store",
          bg_image_url: storeConfigResult.data.bg_image_url ?? "",
        })
      }
      setAudit(auditResult.data ?? [])
      setAdminRoles(roleResult.data ?? [])
      setAdminEmailRoles(emailRoleResult.data ?? [])
      setStats({
        users: profileRows.length ?? userCount.count ?? 0,
        matches: matchCount.count ?? 0,
        activeMatches: activeMatchCount.count ?? 0,
        configItems: (levelResult.data ?? []).length + (tableResult.data ?? []).length + (boardResult.data ?? []).length,
        shopItems: shopResult.data?.length ?? 0,
        suspendedUsers: suspendedCount.count ?? 0,
      })

      const nextSelected = selectedUserId ?? adminUsers[0]?.id ?? null
      if (nextSelected && adminUsers.some((row) => row.id === nextSelected)) {
        setSelectedUserId(nextSelected)
        const selected = adminUsers.find((row) => row.id === nextSelected)
        if (selected) {
          setProfileDraft({
            level: selected.level.toString(),
            xp: selected.xp.toString(),
            rating: selected.rating.toString(),
            admin_note: selected.admin_note ?? "",
            suspension_reason: selected.suspension_reason ?? "",
          })
        }
        await loadSelectedUser(nextSelected)
      }
      else {
        const fallbackSelected = adminUsers[0] ?? null
        setSelectedUserId(fallbackSelected?.id ?? null)
        if (fallbackSelected) {
          setProfileDraft({
            level: fallbackSelected.level.toString(),
            xp: fallbackSelected.xp.toString(),
            rating: fallbackSelected.rating.toString(),
            admin_note: fallbackSelected.admin_note ?? "",
            suspension_reason: fallbackSelected.suspension_reason ?? "",
          })
          await loadSelectedUser(fallbackSelected.id)
        }
        else {
          setSelectedUserDetail(null)
        }
      }
    }
    catch (err) {
      if (isMissingMigrationError(err as {code?: string, message?: string})) {
        setAccessState("migration-missing")
      }
      setError(err)
    }
    finally {
      setRefreshing(false)
    }
  }, [accessState, loadSelectedUser, selectedUserId, setError])

  useEffect(() => {
    queueMicrotask(() => void loadAdminData())
  }, [loadAdminData])

  // RTP summary fetch — keyed off the picked range. Lives in its own
  // hook so the rest of the BO doesn't pay for the aggregation when
  // we're elsewhere.
  const loadRtpSummary = useCallback(async () => {
    // No accessState gate — the BO main view only renders when the
    // admin auth check has resolved, and the section is only reachable
    // from the sidebar inside that view. Anonymous + non-admin callers
    // get rejected by the RPC itself (raises not_admin).
    setRtpLoading(true)
    setRtpError(null)
    try {
      const range = RTP_RANGES.find((r) => r.id === rtpRange)
      const since = range && range.hours !== null ? new Date(Date.now() - range.hours * 60 * 60 * 1000).toISOString() : null
      const {
        data,
        error,
      } = await supabase.rpc("get_rtp_summary", {p_since: since})
      if (error) throw error
      setRtpRows((data ?? []) as unknown as RtpRow[])
    }
    catch (err) {
      setRtpError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setRtpLoading(false)
    }
  }, [rtpRange])

  useEffect(() => {
    if (activeSection !== "RTP Analytics") return
    void loadRtpSummary()
  }, [activeSection, loadRtpSummary])

  // Per-player drill-down. Triggered when the user clicks a tier row;
  // re-fetches when the range changes (so the expanded panel stays in
  // sync with the tier table above it).
  const loadRtpPerPlayer = useCallback(async (tierId: string) => {
    setRtpPlayerLoading(true)
    setRtpPlayerError(null)
    try {
      const range = RTP_RANGES.find((r) => r.id === rtpRange)
      const since = range && range.hours !== null ? new Date(Date.now() - range.hours * 60 * 60 * 1000).toISOString() : null
      const {
        data,
        error,
      } = await supabase.rpc("get_rtp_per_player", {
        p_table_config_id: tierId,
        p_since: since,
        p_limit: 50,
      })
      if (error) throw error
      setRtpPlayerRows((data ?? []) as unknown as RtpPerPlayerRow[])
    }
    catch (err) {
      setRtpPlayerError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setRtpPlayerLoading(false)
    }
  }, [rtpRange])

  useEffect(() => {
    if (!rtpExpandedTier) return
    if (activeSection !== "RTP Analytics") return
    void loadRtpPerPlayer(rtpExpandedTier)
  }, [activeSection, rtpExpandedTier, loadRtpPerPlayer])

  function selectUser(nextUser: AdminUser) {
    setSelectedUserId(nextUser.id)
    setProfileDraft({
      level: nextUser.level.toString(),
      xp: nextUser.xp.toString(),
      rating: nextUser.rating.toString(),
      admin_note: nextUser.admin_note ?? "",
      suspension_reason: nextUser.suspension_reason ?? "",
    })
    void loadSelectedUser(nextUser.id)
  }

  function toggleCheckedUser(profileId: string, checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current)
      if (checked) next.add(profileId); else next.delete(profileId)
      return next
    })
  }

  function toggleAllFilteredUsers(checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current)
      for (const profileId of selectableFilteredUserIds) {
        if (checked) next.add(profileId); else next.delete(profileId)
      }
      return next
    })
  }

  /** Hard-delete (irreversible) — calls the admin_hard_delete_user RPC
   *  which removes the auth.users row + cascades through everything.
   *  Intended for shell/test users that pile up during dev. Guarded
   *  by a type-to-confirm prompt because there's no undo. */
  async function hardDeleteUsers(profileIds: string[]) {
    if (!canManage) return
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== user?.id)
    if (uniqueIds.length === 0) {
      setDataError("Select at least one user that is not your current admin profile.")
      return
    }

    const confirmed = await confirm({
      title: `Hard delete ${uniqueIds.length === 1 ? "this user" : `${uniqueIds.length} users`}?`,
      message: "This is IRREVERSIBLE — the auth.users row is removed and all related " + "wallet / inventory / match data is cascade-deleted from the database.\n\n" + "Type DELETE to confirm.",
      requireWord: "DELETE",
      confirmLabel: "Hard delete",
      tone: "danger",
    })
    if (!confirmed) return

    setSavingKey("user-delete")
    setDataError(null)
    try {
      // Loop sequentially so an error on one row surfaces with the
      // matching id; .rpc() doesn't have a batch form for this.
      for (const id of uniqueIds) {
        const {error} = await supabase.rpc("admin_hard_delete_user", {target_id: id})
        if (error) throw new Error(`${id.slice(0, 8)}…: ${error.message}`)
      }
      setCheckedUserIds(new Set())
      if (selectedUserId && uniqueIds.includes(selectedUserId)) {
        setSelectedUserId(null)
        setSelectedUserDetail(null)
      }
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function softDeleteUsers(profileIds: string[]) {
    if (!canManage) return
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== user?.id)
    if (uniqueIds.length === 0) {
      setDataError("Select at least one user that is not your current admin profile.")
      return
    }

    const note = await prompt({
      title: `Delete ${uniqueIds.length === 1 ? "this user" : `${uniqueIds.length} users`}?`,
      message: "They will be removed from the live user list, but their data remains " + "recoverable in the database. Add an optional note for the audit trail:",
      defaultValue: "Back Office soft delete",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (note === null) return

    setSavingKey("user-delete")
    setDataError(null)
    try {
      const deletePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id ?? null,
        delete_note: emptyToNull(note) ?? "Back Office soft delete",
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspension_reason: "Deleted in Back Office",
        admin_note: `[Deleted in Back Office] ${emptyToNull(note) ?? "Soft delete"}`,
      }
      const {
        data: deletedRows,
        error,
      } = await supabase
        .from("profiles")
        .update(deletePayload)
        .in("id", uniqueIds)
        .is("deleted_at", null)
        .select("id")
      if (isMissingAnyColumnError(error, ["deleted_at", "deleted_by", "delete_note"])) {
        const fallbackPayload = {...deletePayload}
        delete fallbackPayload.deleted_at
        delete fallbackPayload.deleted_by
        delete fallbackPayload.delete_note
        const fallback = await supabase
          .from("profiles")
          .update(fallbackPayload)
          .in("id", uniqueIds)
          .select("id")
        if (fallback.error) throw fallback.error
        if ((fallback.data ?? []).length === 0) {
          throw new Error("No users were deleted. Check that your admin email has owner/admin permissions.")
        }
      }
      else if (error) {
        throw error
      }
      else if ((deletedRows ?? []).length === 0) {
        throw new Error("No users were deleted. Check that your admin email has owner/admin permissions.")
      }

      setCheckedUserIds(new Set())
      if (selectedUserId && uniqueIds.includes(selectedUserId)) {
        setSelectedUserId(null)
        setSelectedUserDetail(null)
      }
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return users
    return users.filter((row) => [row.display_name, row.id, row.rating.toString(), row.level.toString(), accountType(row)]
      .join(" ")
      .toLowerCase()
      .includes(query))
  }, [userSearch, users])

  const selectableFilteredUserIds = filteredUsers
    .filter((row) => row.id !== user?.id)
    .map((row) => row.id)
  const checkedUserCount = checkedUserIds.size
  const allFilteredUsersChecked = selectableFilteredUserIds.length > 0 && selectableFilteredUserIds.every((id) => checkedUserIds.has(id))

  const dashboardCards = useMemo(() => [{
    label: "Users",
    value: formatNumber(stats.users),
    caption: `${stats.suspendedUsers} suspended`,
  }, {
    label: "Matches",
    value: formatNumber(stats.matches),
    caption: "Visible to admins",
  }, {
    label: "Active matches",
    value: formatNumber(stats.activeMatches),
    caption: "Currently open",
  }, {
    label: "Game config",
    value: formatNumber(stats.configItems),
    caption: "Levels, rooms, themes",
  }, {
    label: "Shop items",
    value: formatNumber(stats.shopItems),
    caption: "Products and offers",
  }], [stats])

  function openAddBoard() {
    setBoardMessage(null)
    setBoardDraft(boardToDraft())
    setBoardEditorMode("add")
    setBoardEditorOpen(true)
  }

  function openEditBoard(board: BoardThemeConfig) {
    setBoardMessage(null)
    setBoardDraft(boardToDraft(board))
    setBoardEditorMode("edit")
    setBoardEditorOpen(true)
  }

  async function saveProfile() {
    if (!canManage || !selectedUser) return
    setSavingKey("profile")
    setDataError(null)
    try {
      const {error} = await supabase
        .from("profiles")
        .update({
          level: requiredNumber(profileDraft.level, "Level"),
          xp: requiredNumber(profileDraft.xp, "XP"),
          rating: requiredNumber(profileDraft.rating, "Rating"),
          admin_note: emptyToNull(profileDraft.admin_note),
          suspension_reason: selectedUser.is_suspended ? emptyToNull(profileDraft.suspension_reason) : null,
          suspended_at: selectedUser.is_suspended ? (selectedUser.suspended_at ?? new Date().toISOString()) : null,
        })
        .eq("id", selectedUser.id)
      if (error) throw error
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function toggleSuspension(target: AdminUser) {
    if (!canManage) return
    setSavingKey(`suspend-${target.id}`)
    setDataError(null)
    try {
      const next = !target.is_suspended
      const {error} = await supabase
        .from("profiles")
        .update({
          is_suspended: next,
          suspended_at: next ? new Date().toISOString() : null,
          suspension_reason: next ? emptyToNull(profileDraft.suspension_reason) ?? "Admin suspension" : null,
        })
        .eq("id", target.id)
      if (error) throw error
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function adjustWallet() {
    if (!canManage || !selectedUser) return
    setSavingKey("wallet")
    setDataError(null)
    try {
      const amount = requiredNumber(walletDraft.amount, "Amount")
      const {error} = await supabase.rpc("admin_adjust_wallet", {
        target_profile_id: selectedUser.id,
        currency_code: walletDraft.currency,
        delta_amount: amount,
        adjustment_reason: walletDraft.reason,
      })
      if (error) throw error
      setWalletDraft({
        currency: "coins",
        amount: "",
        reason: "",
      })
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveLevel() {
    if (!canManage) return
    setSavingKey("level")
    setDataError(null)
    try {
      const level = requiredNumber(levelDraft.level, "Level")
      if (!Number.isInteger(level) || level < 1) {
        // The DB enforces `level > 0` on an int PK. A blank Level field
        // resolves to Number('') === 0, which used to hit the database and
        // surface the raw "level_configs_level_check" violation. Validate
        // here so the operator gets a clear message instead.
        throw new Error("Level must be a whole number of 1 or more.")
      }
      const payload: Database["public"]["Tables"]["level_configs"]["Insert"] = {
        level,
        xp_required: requiredNumber(levelDraft.xp_required, "XP required"),
        status_label: levelDraft.status_label.trim() || "Rookie",
        reward_coins: requiredNumber(levelDraft.reward_coins, "Reward coins"),
        reward_gems: requiredNumber(levelDraft.reward_gems, "Reward gems"),
        reward_items: parseJson(levelDraft.reward_items, "Reward items", "array"),
        unlock_rules: parseJson(levelDraft.unlock_rules, "Unlock rules", "object"),
        is_enabled: levelDraft.is_enabled,
        updated_by: user?.id ?? null,
      }
      const {error} = await supabase.from("level_configs").upsert(payload)
      if (isMissingColumnError(error, "status_label")) {
        const fallbackPayload = {...payload}
        delete fallbackPayload.status_label
        const fallback = await supabase.from("level_configs").upsert(fallbackPayload)
        if (fallback.error) throw fallback.error
      }
      else if (error) {
        throw error
      }
      setLevelDraft(levelToDraft())
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  // The tier panel is a small inline list. `tierDrafts` is the editable
  // mirror of `levelStatusTiers` (the last loaded snapshot). On Save we
  // diff: any draft.id that no longer exists in drafts gets deleted,
  // any draft with id=null gets inserted, the rest get updated. Then we
  // refetch to get fresh ids + audit timestamps.

  function updateTierDraft(index: number, patch: Partial<LevelStatusTierDraft>) {
    setTierDrafts((rows) => rows.map((row, i) => (i === index ? {...row, ...patch} : row)))
  }

  function addBlankTier() {
    // Default the new row's level_from to one past the previous row's
    // level_to so a designer adding tiers in order doesn't have to
    // re-type the boundary. Empty list -> start at 1.
    const lastTo = tierDrafts.length ? Math.max(0, Number.parseInt(tierDrafts[tierDrafts.length - 1].level_to, 10) || 0) : 0
    const nextFrom = lastTo > 0 ? lastTo + 1 : 1
    setTierDrafts((rows) => [...rows, {
      id: null,
      level_from: String(nextFrom),
      level_to: "",
      label: "",
      sort_order: String(rows.length + 1),
      is_enabled: true,
    }])
  }

  function removeTierDraft(index: number) {
    setTierDrafts((rows) => rows.filter((_, i) => i !== index))
  }

  function resetTierDrafts() {
    setTierDrafts(levelStatusTiers.map((t) => ({
      id: t.id,
      level_from: String(t.level_from),
      level_to: String(t.level_to),
      label: t.label,
      sort_order: String(t.sort_order),
      is_enabled: t.is_enabled,
    })))
    setTierError(null)
    setTierMessage(null)
  }

  async function saveTiers() {
    if (!canManage || savingTiers) return
    setSavingTiers(true)
    setTierError(null)
    setTierMessage(null)
    try {
      // Validate before any DB call so we don't end up with a
      // partially-saved set on bad input.
      const validated = tierDrafts.map((draft, i) => {
        const from = Number.parseInt(draft.level_from, 10)
        const to = Number.parseInt(draft.level_to, 10)
        const sort = Number.parseInt(draft.sort_order, 10)
        if (!Number.isFinite(from) || from <= 0) {
          throw new Error(`Tier #${i + 1}: "From" must be a positive integer.`)
        }
        if (!Number.isFinite(to) || to < from) {
          throw new Error(`Tier #${i + 1}: "To" must be ≥ "From" (got ${draft.level_to}).`)
        }
        const label = draft.label.trim()
        if (!label) throw new Error(`Tier #${i + 1}: label is required.`)
        return {
          id: draft.id,
          level_from: from,
          level_to: to,
          label,
          sort_order: Number.isFinite(sort) ? sort : i + 1,
          is_enabled: draft.is_enabled,
        }
      })

      const draftIds = new Set(validated.map((v) => v.id).filter((id): id is string => !!id))
      const toDelete = levelStatusTiers
        .filter((existing) => !draftIds.has(existing.id))
        .map((t) => t.id)
      const toInsert = validated.filter((v) => v.id === null)
      const toUpdate = validated.filter((v) => v.id !== null)

      if (toDelete.length > 0) {
        const {error} = await supabase
          .from("level_status_tiers")
          .delete()
          .in("id", toDelete)
        if (error) throw error
      }
      if (toInsert.length > 0) {
        const {error} = await supabase.from("level_status_tiers").insert(toInsert.map((row) => ({
          level_from: row.level_from,
          level_to: row.level_to,
          label: row.label,
          sort_order: row.sort_order,
          is_enabled: row.is_enabled,
          updated_by: user?.id ?? null,
        })))
        if (error) throw error
      }
      if (toUpdate.length > 0) {
        // No bulk update RPC for arbitrary per-row changes, so issue
        // a per-row .update(). The tier table is small (~10 rows
        // max), so this is fine.
        for (const row of toUpdate) {
          if (!row.id) continue
          const {error} = await supabase
            .from("level_status_tiers")
            .update({
              level_from: row.level_from,
              level_to: row.level_to,
              label: row.label,
              sort_order: row.sort_order,
              is_enabled: row.is_enabled,
              updated_by: user?.id ?? null,
            })
            .eq("id", row.id)
          if (error) throw error
        }
      }
      setTierMessage(`Saved. ${toInsert.length} added · ${toUpdate.length} updated · ${toDelete.length} removed.`)
      await loadAdminData()
    }
    catch (err) {
      setTierError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setSavingTiers(false)
    }
  }

  async function saveGrant() {
    if (!canManage) return
    setSavingKey("grant")
    setDataError(null)
    try {
      const triggerKey = grantDraft.trigger_key.trim().toLowerCase()
      if (!/^[a-z][a-z0-9_]*$/.test(triggerKey)) {
        throw new Error("Trigger key must be lowercase letters/numbers/underscores, starting with a letter (e.g. refer_friend).")
      }
      if (!grantDraft.display_name.trim()) {
        throw new Error("Display name is required.")
      }
      const {error} = await supabase.rpc("admin_upsert_economy_grant", {
        p_trigger_key: triggerKey,
        p_display_name: grantDraft.display_name.trim(),
        p_description: grantDraft.description.trim(),
        p_coins: requiredNumber(grantDraft.coins, "Coins"),
        p_gems: requiredNumber(grantDraft.gems, "Gems"),
        p_one_time: grantDraft.one_time,
        p_is_enabled: grantDraft.is_enabled,
        p_sort_order: requiredNumber(grantDraft.sort_order, "Sort order"),
      })
      if (error) throw error
      setGrantDraft(grantToDraft())
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveLobbyFeature(featureKey: string) {
    if (!canManage) return
    setSavingKey(`feature:${featureKey}`)
    setDataError(null)
    try {
      const row = lobbyFeatures.find((f) => f.feature_key === featureKey)
      if (!row) return
      const level = requiredNumber(row.level, "Unlock level")
      if (level < 1) throw new Error("Unlock level must be at least 1.")
      const tooltip = row.tooltip.trim()
      const {error} = await supabase
        .from("lobby_feature_configs")
        .update({
          unlock_level: level,
          is_enabled: row.enabled,
          tooltip_text: tooltip === "" ? null : tooltip,
        })
        .eq("feature_key", featureKey)
      if (error) throw error
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveDailyBonus() {
    if (!canManage) return
    setSavingKey("daily-bonus")
    setDataError(null)
    try {
      const day = requiredNumber(dailyBonusDraft.day, "Day")
      if (day < 1 || day > 7) throw new Error("Day must be between 1 and 7.")
      const payload: Database["public"]["Tables"]["daily_bonus_configs"]["Insert"] = {
        day,
        reward_coins: requiredNumber(dailyBonusDraft.reward_coins, "Reward coins"),
        reward_gems: requiredNumber(dailyBonusDraft.reward_gems, "Reward gems"),
        reward_xp: requiredNumber(dailyBonusDraft.reward_xp, "Reward XP"),
        reward_items: parseJson(dailyBonusDraft.reward_items, "Reward items", "array"),
        updated_by: user?.id ?? null,
      }
      const {error} = await supabase
        .from("daily_bonus_configs")
        .upsert(payload, {onConflict: "day"})
      if (error) throw error
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveCurrency() {
    if (!canManage) return
    setSavingKey("currency")
    setDataError(null)
    try {
      const code = currencyDraft.code.trim()
      if (!code) throw new Error("Currency code is required.")
      if (!/^[a-z][a-z0-9_]*$/.test(code)) {
        throw new Error("Code must be lowercase letters, digits, or underscores, starting with a letter.")
      }
      const displayName = currencyDraft.display_name.trim()
      if (!displayName) throw new Error("Display name is required.")
      const usd = Number(currencyDraft.usd_value)
      if (!Number.isFinite(usd) || usd < 0) {
        throw new Error("USD value must be a non-negative number (e.g. 0.01).")
      }
      // Convert "$X.YZ" → micros. Round so 0.0001 doesn't drift to 99.
      const micros = Math.round(usd * 1_000_000)
      const sortOrder = requiredNumber(currencyDraft.sort_order, "Sort order")
      await upsertCurrency({
        p_code: code,
        p_display_name: displayName,
        p_usd_value_micros: micros,
        p_is_enabled: currencyDraft.is_enabled,
        p_sort_order: sortOrder,
      }).unwrap()
      setCurrencyDraft(currencyToDraft())
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveTable() {
    if (!canManage) return
    setSavingKey("table")
    setDataError(null)
    try {
      const xpMult = requiredNumber(tableDraft.xp_multiplier_pct, "XP multiplier")
      if (xpMult < 0 || xpMult > 10000) {
        throw new Error("XP multiplier must be between 0 and 10000.")
      }
      const turnSec = requiredNumber(tableDraft.turn_seconds, "Turn seconds")
      if (turnSec < 5 || turnSec > 600) {
        throw new Error("Turn seconds must be between 5 and 600.")
      }
      const targetRtp = requiredNumber(tableDraft.target_rtp_pct, "Target RTP")
      if (targetRtp < 0 || targetRtp > 200) {
        throw new Error("Target RTP must be between 0 and 200.")
      }
      const payload: Database["public"]["Tables"]["table_configs"]["Insert"] = {
        id: tableDraft.id.trim(),
        kind: tableDraft.kind,
        display_name: tableDraft.display_name.trim(),
        description: tableDraft.description.trim(),
        entry_fee_coins: requiredNumber(tableDraft.entry_fee_coins, "Entry fee"),
        prize_coins: requiredNumber(tableDraft.prize_coins, "Prize"),
        prize_coins_loss: requiredNumber(tableDraft.prize_coins_loss, "Lose prize"),
        required_level: requiredNumber(tableDraft.required_level, "Required level"),
        match_target: requiredNumber(tableDraft.match_target, "Match target"),
        allow_ai: tableDraft.allow_ai,
        allow_online: tableDraft.allow_online,
        is_enabled: tableDraft.is_enabled,
        sort_order: requiredNumber(tableDraft.sort_order, "Sort order"),
        xp_multiplier_pct: xpMult,
        base_xp_win: requiredNumber(tableDraft.base_xp_win, "Base XP"),
        turn_seconds: turnSec,
        accent_color: tableDraft.accent_color.trim() || "gold",
        ai_level: tableDraft.ai_level,
        target_rtp_pct: targetRtp,
        metadata: parseJson(tableDraft.metadata, "Metadata", "object"),
        updated_by: user?.id ?? null,
      }
      const {error} = await supabase.from("table_configs").upsert(payload)
      if (error) throw error
      setTableDraft(tableToDraft())
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveBoard() {
    if (!canManage) return
    setSavingKey("board")
    setDataError(null)
    setBoardMessage(null)
    try {
      const metadata = withGameplayBackgroundMetadata(parseJson(boardDraft.metadata, "Metadata", "object"), boardDraft.gameplay_background_image)
      const payload: Database["public"]["Tables"]["board_theme_configs"]["Insert"] = {
        id: boardDraft.id.trim(),
        display_name: boardDraft.display_name.trim(),
        preview_image: boardDraft.preview_image.trim(),
        gameplay_image: boardDraft.gameplay_image.trim(),
        lobby_background_image: emptyToNull(boardDraft.lobby_background_image),
        white_checker_image: emptyToNull(boardDraft.white_checker_image),
        black_checker_image: emptyToNull(boardDraft.black_checker_image),
        dice_image: emptyToNull(boardDraft.dice_image),
        tray_image: emptyToNull(boardDraft.tray_image),
        holder_image: emptyToNull(boardDraft.holder_image),
        unlock_level: requiredNumber(boardDraft.unlock_level, "Unlock level"),
        price_coins: requiredNumber(boardDraft.price_coins, "Price coins"),
        price_gems: requiredNumber(boardDraft.price_gems, "Gems cost"),
        is_enabled: boardDraft.is_enabled,
        is_featured: boardDraft.is_featured,
        sort_order: requiredNumber(boardDraft.sort_order, "Sort order"),
        metadata,
        updated_by: user?.id ?? null,
      }
      const {error} = await withRequestTimeout(supabase.from("board_theme_configs").upsert(payload, {onConflict: "id"}).select("id"), "Saving board theme")
      if (error) throw error
      setBoardDraft(boardToDraft())
      setBoardEditorOpen(false)
      await loadBoardConfigs("Board theme saved.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deleteBoard(board: BoardThemeConfig) {
    if (!canManage) return
    const confirmed = await confirm({
      title: `Delete ${board.display_name}?`,
      message: "This removes it from the live board list.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    setSavingKey(`board-delete-${board.id}`)
    setDataError(null)
    setBoardMessage(null)
    try {
      const {error} = await withRequestTimeout(supabase.from("board_theme_configs").delete().eq("id", board.id).select("id"), "Deleting board theme")
      if (error) throw error
      if (boardDraft.id === board.id) {
        setBoardDraft(boardToDraft())
        setBoardEditorOpen(false)
      }
      await loadBoardConfigs("Board theme deleted.")
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function seedBuiltInBoards() {
    if (!canManage) return
    setSavingKey("board-seed")
    setDataError(null)
    setBoardMessage("Adding the current game boards...")
    try {
      const payload = builtInBoardSeeds.map((board) => ({
        ...board,
        updated_by: user?.id ?? null,
      }))
      const {
        data,
        error,
      } = await withRequestTimeout(supabase.from("board_theme_configs").upsert(payload, {onConflict: "id"}).select("id"), "Populating current boards")
      if (error) throw error
      await loadBoardConfigs(`Current boards populated: ${data?.length ?? builtInBoardSeeds.length} boards are ready.`)
    }
    catch (err) {
      setBoardMessage(null)
      if (isPolicyError(err)) {
        setDataError("Supabase blocked the board write. Please run the latest board_theme_admin_write_policy migration in the Supabase SQL editor, then try again.")
      }
      else {
        setError(err)
      }
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveShop() {
    if (!canManage) return
    setSavingKey("shop")
    setDataError(null)
    try {
      const payload: Database["public"]["Tables"]["shop_items"]["Insert"] = {
        id: shopDraft.id.trim(),
        kind: shopDraft.kind,
        display_name: shopDraft.display_name.trim(),
        description: shopDraft.description.trim(),
        image_url: emptyToNull(shopDraft.image_url),
        price_cents: numberOrNull(shopDraft.price_cents),
        price_coins: numberOrNull(shopDraft.price_coins),
        price_gems: numberOrNull(shopDraft.price_gems),
        apple_product_id: emptyToNull(shopDraft.apple_product_id),
        google_product_id: emptyToNull(shopDraft.google_product_id),
        contents: parseJson(shopDraft.contents, "Contents", "object"),
        visibility_rules: parseJson(shopDraft.visibility_rules, "Visibility rules", "object"),
        starts_at: shopDraft.starts_at ? new Date(shopDraft.starts_at).toISOString() : null,
        ends_at: shopDraft.ends_at ? new Date(shopDraft.ends_at).toISOString() : null,
        max_purchases_per_user: numberOrNull(shopDraft.max_purchases_per_user),
        is_enabled: shopDraft.is_enabled,
        exclude_from_sale: shopDraft.exclude_from_sale,
        sort_order: requiredNumber(shopDraft.sort_order, "Sort order"),
        updated_by: user?.id ?? null,
      }
      const {error} = await supabase.from("shop_items").upsert(payload)
      if (error) throw error
      setShopDraft(shopToDraft())
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveStoreSale() {
    if (!canManage) return
    setSavingKey("store-sale")
    setDataError(null)
    try {
      const payload = {
        label: saleDraft.label.trim() || "Store Sale",
        bonus_percent: requiredNumber(saleDraft.bonus_percent, "Bonus %"),
        is_active: saleDraft.is_active,
        starts_at: saleDraft.starts_at ? new Date(saleDraft.starts_at).toISOString() : null,
        ends_at: saleDraft.ends_at ? new Date(saleDraft.ends_at).toISOString() : null,
      }
      const {error} = saleDraft.id ? await supabase.from("store_sales").update(payload).eq("id", saleDraft.id) : await supabase.from("store_sales").insert(payload)
      if (error) throw error
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveStoreConfig() {
    if (!canManage) return
    setSavingKey("store-config")
    setDataError(null)
    try {
      const payload = {
        id: true,
        title: storeConfigDraft.title.trim() || "Store",
        bg_image_url: storeConfigDraft.bg_image_url.trim() || null,
      }
      const {error} = await supabase.from("store_config").upsert(payload, {onConflict: "id"})
      if (error) throw error
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deleteShop() {
    if (!canManage) return
    const id = shopDraft.id.trim()
    if (!id) return
    if (!(await confirm({
      title: `Delete shop item "${shopDraft.display_name.trim() || id}"?`,
      message: "It's removed from the store immediately. Past purchases are kept.",
      confirmLabel: "Delete",
      tone: "danger",
    }))) return
    setSavingKey("shop-delete")
    setDataError(null)
    try {
      const {error} = await supabase.from("shop_items").delete().eq("id", id)
      if (error) throw error
      setShopDraft(shopToDraft())
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveAdminRole() {
    if (!canManage) return
    setSavingKey("role")
    setDataError(null)
    try {
      const {error} = await supabase.from("admin_roles").upsert({
        profile_id: roleDraft.profile_id.trim(),
        role: roleDraft.role,
        note: emptyToNull(roleDraft.note),
        created_by: user?.id ?? null,
      })
      if (error) throw error
      setRoleDraft({
        profile_id: "",
        role: "viewer",
        note: "",
      })
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

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

  async function saveAdminEmailRole() {
    if (!canManage) return
    const email = normalizeEmail(emailRoleDraft.email)
    if (!email.includes("@")) {
      setDataError("Enter a valid email address.")
      return
    }

    setSavingKey("email-role")
    setDataError(null)
    try {
      const payload: Database["public"]["Tables"]["admin_email_allowlist"]["Insert"] = {
        email,
        role: emailRoleDraft.role,
        note: emptyToNull(emailRoleDraft.note),
        created_by: user?.id ?? null,
      }
      const {error} = await supabase
        .from("admin_email_allowlist")
        .upsert(payload, {onConflict: "email"})
      if (error) throw error
      setEmailRoleDraft({
        email: "",
        role: "viewer",
        note: "",
      })
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deleteAdminEmailRole(row: AdminEmailRoleRow) {
    if (!canManage) return
    if (row.email === currentUserEmail) {
      setDataError("You can't remove the admin email you are currently using.")
      return
    }
    const confirmed = await confirm({
      title: `Remove admin access for ${row.email}?`,
      confirmLabel: "Remove access",
      tone: "danger",
    })
    if (!confirmed) return

    setSavingKey(`email-role-delete-${row.email}`)
    setDataError(null)
    try {
      const {error} = await supabase.from("admin_email_allowlist").delete().eq("email", row.email)
      if (error) throw error
      setEmailRoleDraft({
        email: "",
        role: "viewer",
        note: "",
      })
      await loadAdminData()
    }
    catch (err) {
      setError(err)
    }
    finally {
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
    {confirmUI}
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
            onClick={() => void loadAdminData()}>
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
            element={<DashboardAdmin
              audit={audit}
              cards={dashboardCards}/>}
            path="dashboard"/>

          <Route
            element={<UsersAdmin
              allFilteredUsersChecked={allFilteredUsersChecked}
              canManage={canManage}
              checkedUserCount={checkedUserCount}
              checkedUserIds={checkedUserIds}
              currentUserId={user?.id ?? null}
              filteredUsers={filteredUsers}
              onlineUsers={onlineUsers}
              profileDraft={profileDraft}
              savingKey={savingKey}
              selectableFilteredUserIds={selectableFilteredUserIds}
              selectedUser={selectedUser}
              selectedUserDetail={selectedUserDetail}
              selectedUserId={selectedUserId}
              userSearch={userSearch}
              walletDraft={walletDraft}
              onAdjustWallet={() => void adjustWallet()}
              onHardDelete={(profileIds) => void hardDeleteUsers(profileIds)}
              onProfileFieldChange={(field, value) => {
                setProfileDraft((d) => ({
                  ...d,
                  [field]: value,
                }))
              }}
              onSaveProfile={() => void saveProfile()}
              onSelectUser={selectUser}
              onSoftDelete={(profileIds) => void softDeleteUsers(profileIds)}
              onToggleAllFiltered={toggleAllFilteredUsers}
              onToggleChecked={toggleCheckedUser}
              onToggleSuspension={(target) => void toggleSuspension(target)}
              onUserSearchChange={setUserSearch}
              onWalletFieldChange={(field, value) => {
                setWalletDraft((d) => ({
                  ...d,
                  [field]: value,
                }))
              }}/>}
            path="users"/>

          <Route
            element={<CurrenciesAdmin
              canManage={canManage}
              currencies={currencies}
              currencyDraft={currencyDraft}
              savingKey={savingKey}
              onFieldChange={(field, value) => {
                setCurrencyDraft((d) => ({
                  ...d,
                  [field]: value,
                }))
              }}
              onNew={() => {
                setCurrencyDraft(currencyToDraft())
              }}
              onSave={() => void saveCurrency()}
              onSelectCurrency={(index) => {
                setCurrencyDraft(currencyToDraft(currencies[index]))
              }}
              onToggleEnabled={(is_enabled) => {
                setCurrencyDraft((d) => ({
                  ...d,
                  is_enabled,
                }))
              }}/>}
            path="currencies"/>

          <Route
            element={<EconomyGrantsAdmin
              canManage={canManage}
              economyGrants={economyGrants}
              grantDraft={grantDraft}
              savingKey={savingKey}
              onFieldChange={(field, value) => {
                setGrantDraft((d) => ({
                  ...d,
                  [field]: value,
                }))
              }}
              onNew={() => {
                setGrantDraft(grantToDraft())
              }}
              onSave={() => void saveGrant()}
              onSelectGrant={(index) => {
                setGrantDraft(grantToDraft(economyGrants[index]))
              }}
              onToggleEnabled={(is_enabled) => {
                setGrantDraft((d) => ({
                  ...d,
                  is_enabled,
                }))
              }}
              onToggleOneTime={(one_time) => {
                setGrantDraft((d) => ({
                  ...d,
                  one_time,
                }))
              }}/>}
            path="economy-grants"/>

          <Route
            element={<LevelSystemAdmin
              canManage={canManage}
              currentUserId={user?.id ?? null}
              levelDraft={levelDraft}
              levels={levels}
              levelsPageIndex={levelsPageIndex}
              levelsPageSize={levelsPageSize}
              rateMap={rateMap}
              savingKey={savingKey}
              savingTiers={savingTiers}
              tierDrafts={tierDrafts}
              tierError={tierError}
              tierMessage={tierMessage}
              onAddBlankTier={addBlankTier}
              onApplied={loadAdminData}
              onLevelDraftChange={(patch) => {
                setLevelDraft((d) => ({...d, ...patch}))
              }}
              onLevelsPageIndexChange={setLevelsPageIndex}
              onLevelsPageSizeChange={setLevelsPageSize}
              onNewLevel={() => {
                // Pre-fill the next free level so "New" on a packed
                // 1..N table proposes N+1 instead of a blank field
                // (blank saved as level 0 and tripped the `level > 0`
                // check constraint). Operator can still overwrite it.
                const nextLevel = levels.reduce((max, row) => Math.max(max, row.level), 0) + 1
                setLevelDraft({
                  ...levelToDraft(),
                  level: String(nextLevel),
                })
              }}
              onRemoveTierDraft={removeTierDraft}
              onResetTierDrafts={resetTierDrafts}
              onSaveLevel={saveLevel}
              onSaveTiers={saveTiers}
              onUpdateTierDraft={updateTierDraft}/>}
            path="level-system"/>

          <Route
            element={<DailyBonusAdmin
              canManage={canManage}
              dailyBonusConfigs={dailyBonusConfigs}
              dailyBonusDraft={dailyBonusDraft}
              rateMap={rateMap}
              savingKey={savingKey}
              onFieldChange={(field, value) => {
                setDailyBonusDraft((d) => ({
                  ...d,
                  [field]: value,
                }))
              }}
              onReset={() => {
                setDailyBonusDraft(dailyBonusToDraft())
              }}
              onSave={() => void saveDailyBonus()}
              onSelectDay={(index) => {
                setDailyBonusDraft(dailyBonusToDraft(dailyBonusConfigs[index]))
              }}/>}
            path="daily-bonus"/>

          <Route
            element={<HourlyWheelAdmin canManage={canManage}/>}
            path="hourly-wheel"/>

          <Route
            element={<MissionsAdmin canManage={canManage}/>}
            path="daily-missions"/>

          {/* "Tables / Rooms" (kind='standard') section removed — the lobby only
                surfaces difficulty tiers now (DifficultyModal queries kind='difficulty'),
                so the standard-rooms editor was dead UI. The shared tableDraft / saveTable
                / tableToDraft state stays in place for the Difficulties section below; the
                underlying table_configs data is untouched. */}

          <Route
            element={<DifficultiesAdmin
              canManage={canManage}
              difficultyAccentColors={difficultyAccentColors}
              rateMap={rateMap}
              savingKey={savingKey}
              tableDraft={tableDraft}
              tables={tables}
              onNewDifficulty={() => {
                setTableDraft(tableToDraft(undefined, "difficulty"))
              }}
              onSaveTable={() => void saveTable()}
              onSelectDifficulty={(index) => {
                const diffRows = tables.filter((row) => row.kind === "difficulty")
                setTableDraft(tableToDraft(diffRows[index], "difficulty"))
              }}
              onTableDraftChange={(patch) => {
                setTableDraft((d) => ({
                  ...d,
                  ...patch,
                }))
              }}/>}
            path="difficulties"/>

          <Route
            element={<RTPAnalyticsAdmin
              ranges={RTP_RANGES}
              rtpError={rtpError}
              rtpExpandedTier={rtpExpandedTier}
              rtpLoading={rtpLoading}
              rtpPlayerError={rtpPlayerError}
              rtpPlayerLoading={rtpPlayerLoading}
              rtpPlayerRows={rtpPlayerRows}
              rtpRange={rtpRange}
              rtpRows={rtpRows}
              onOpenUser={(profileId) => {
                setSelectedUserId(profileId)
                void navigate("/users")
              }}
              onRefresh={() => void loadRtpSummary()}
              onSetRtpRange={setRtpRange}
              onToggleTier={(tierId) => {
                setRtpExpandedTier((current) => current === tierId ? null : tierId)
              }}/>}
            path="rtp-analytics"/>

          <Route
            element={<BoardThemesAdmin
              boardDraft={boardDraft}
              boardEditorMode={boardEditorMode}
              boardEditorOpen={boardEditorOpen}
              boardMessage={boardMessage}
              boards={boards}
              canManage={canManage}
              loadingScreenDraft={loadingScreenDraft}
              loadingScreens={loadingScreens}
              podiumDraft={podiumDraft}
              podiums={podiums}
              savingKey={savingKey}
              onActivateLoadingScreen={(screen) => void activateLoadingScreen(screen)}
              onActivatePodium={(podium) => void activatePodium(podium)}
              onAddLoadingScreen={() => void addLoadingScreen()}
              onAddPodium={() => void addPodium()}
              onDeleteBoard={(board) => void deleteBoard(board)}
              onDeleteLoadingScreen={(screen) => void deleteLoadingScreen(screen)}
              onDeletePodium={(podium) => void deletePodium(podium)}
              onOpenAddBoard={openAddBoard}
              onOpenEditBoard={openEditBoard}
              onSaveBoard={() => void saveBoard()}
              onSeedBuiltInBoards={() => void seedBuiltInBoards()}
              onSetBoardDraft={setBoardDraft}
              onSetBoardEditorOpen={setBoardEditorOpen}
              onSetLoadingScreenDraft={setLoadingScreenDraft}
              onSetPodiumDraft={setPodiumDraft}/>}
            path="board-themes"/>

          <Route
            element={<LobbyFeaturesAdmin
              canManage={canManage}
              lobbyFeatures={lobbyFeatures}
              savingKey={savingKey}
              onChangeEnabled={(featureKey, enabled) => {
                setLobbyFeatures((rows) => rows.map((r) => r.feature_key === featureKey ? {
                  ...r,
                  enabled,
                } : r))
              }}
              onChangeLevel={(featureKey, level) => {
                setLobbyFeatures((rows) => rows.map((r) => r.feature_key === featureKey ? {
                  ...r,
                  level,
                } : r))
              }}
              onChangeTooltip={(featureKey, tooltip) => {
                setLobbyFeatures((rows) => rows.map((r) => r.feature_key === featureKey ? {
                  ...r,
                  tooltip,
                } : r))
              }}
              onSave={(featureKey) => {
                void saveLobbyFeature(featureKey)
              }}/>}
            path="lobby-features"/>

          <Route
            element={<ShopAdmin
              canManage={canManage}
              saleDraft={saleDraft}
              savingKey={savingKey}
              shopDraft={shopDraft}
              shopItems={shopItems}
              storeConfigDraft={storeConfigDraft}
              onDeleteShop={() => void deleteShop()}
              onSaveShop={() => void saveShop()}
              onSaveStoreConfig={() => void saveStoreConfig()}
              onSaveStoreSale={() => void saveStoreSale()}
              onSetSaleDraft={setSaleDraft}
              onSetShopDraft={setShopDraft}
              onSetStoreConfigDraft={setStoreConfigDraft}/>}
            path="shop"/>

          <Route
            element={<AdminAccessAdmin
              adminEmailRoles={adminEmailRoles}
              adminRoles={adminRoles}
              audit={audit}
              canManage={canManage}
              currentUserEmail={currentUserEmail}
              emailRoleDraft={emailRoleDraft}
              roleDraft={roleDraft}
              roleOptions={roleOptions}
              savingKey={savingKey}
              selectedEmailRole={selectedEmailRole}
              onDeleteAdminEmailRole={(row) => {
                void deleteAdminEmailRole(row)
              }}
              onEmailRoleDraftChange={setEmailRoleDraft}
              onRoleDraftChange={setRoleDraft}
              onSaveAdminEmailRole={() => {
                void saveAdminEmailRole()
              }}
              onSaveAdminRole={() => {
                void saveAdminRole()
              }}/>}
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
