# Admin Reference

> Reference · As-built · Owner: Yaniv · Compiled as-of: 2026-08-10

Describes the Back Office: access model, section registry, operator workflows,
config ownership, reporting, and app structure. It describes operator control,
not economy formulas (see `docs/reference/05-economy-reference.md`).

## 1. Scope and audience

For operators and developers working on the Back Office (`apps/admin/`). The
admin app is an independent Redux application with its own store and a single
admin RTK Query API.

## 2. Access model: allowlist, roles, guarded RPCs, RLS

Two granting mechanisms, merged server-side:

- `public.admin_roles` (profile_id-keyed; roles `owner|admin|support|viewer`).
  (`20260511140413_admin_foundation.sql:9-16`)
- `public.admin_email_allowlist` (email-keyed, lowercased, format-checked).
  (`20260514070817_admin_email_allowlist.sql:8-19`) Seeded with
  `contact@yanivos.com` as `owner`, so the first operator can sign in with Google
  before any `admin_roles` row exists. (`:30-33`)
- `private.current_admin_role()` (SECURITY DEFINER) unions both sources with
  precedence owner > admin > support > viewer. (`20260514070817_admin_email_allowlist.sql:31-61`)

Role predicates: `private.is_admin()` = any of the four roles;
`private.can_manage_config()` = owner/admin only.
(`20260511140413_admin_foundation.sql:26-51`)

Shell gate: `public.get_my_admin_role()` is the single client-visible check.
`AdminAuthGate.tsx` mounts the shell only on `allowed`; `fetchMyAdminAccess`
also probes `profiles` + `shop_items` for readiness ("migration-missing" state).
The gate's `getMyAdminAccess` query is deliberately untagged so global Refresh
cannot unmount the shell mid-edit. (`AdminAccessApi.ts:36-50`)

Guarded RPCs (SECURITY DEFINER, inline `is_admin`/`can_manage_config` checks,
EXECUTE granted to `authenticated`):

- `admin_adjust_wallet` (owner/admin) — `20260512100937_back_office_management_v1.sql:155-220`
- `admin_hard_delete_user` (owner/admin, no self-delete) — `20260701000000_admin_hard_delete_user.sql:27-75`
- `admin_upsert_currency_config` — `20260702000000_currency_configs.sql:83-140`;
  `admin_upsert_economy_grant` — `20260705000000_economy_grants.sql:197-258`
- `get_rtp_summary` (any admin) — `20260604000000_rtp_summary_rpc.sql:39-130`;
  `get_rtp_per_player` (any admin, p_limit capped 1..200) — `20260605000000_rtp_per_player_rpc.sql:24-53`
- `recompute_player_levels` — `20260704000000_recompute_player_levels.sql:27-65`;
  `set_active_podium` / `set_active_loading_screen` (owner/admin) —
  `20260706000000_podium_images.sql:87-113`, `20260731000000_loading_screen_images.sql:88-115`
- `admin_refresh_player_missions` (owner/admin) — `20260723500000_admin_refresh_player_missions.sql:11-51`
- `simulate_*` test harness (owner/admin) — `20260628000000_daily_missions_v7_simulation_harness.sql:21-230`
- `test_purchase_shop_item` (owner/admin) — `20260613000000_shop_purchase_core_and_test.sql:238-275`
  (exists server-side but NOT called from the admin UI — see gaps)

Hardening: `20260711000000_revoke_server_fn_grants.sql:11-51` revokes `anon` from
all server-only functions and `authenticated` from the four pure pg_cron
functions.

RLS pattern: config tables read-all, write via `can_manage_config` policies
(e.g. `level_configs`, `table_configs`, `board_theme_configs`,
`shop_items`, `lobby_feature_configs`, `store_sales`, `store_config`).
Player/ledger tables own-row-or-admin read, admin write. Mission reference tables
follow the same split. Note: `wheel_configs`/`wheel_slots` writes use
`private.is_admin` (any role) rather than `can_manage_config` — a wider gate than
every other config table. (`20260617000000_hourly_wheel.sql:99-107`)

UI enforcement: `Admin.tsx:88-89` derives `role` and `canManage = owner||admin`;
every section receives `canManage` and disables editing for viewer/support.

## 3. Section registry and URLs

- Registry: `apps/admin/src/lib/adminSections.ts:1-19` — 14 sections. Routes
  rendered in `Admin.tsx:165-236`, basename `/admin` (`App.tsx:26`), so URLs are
  `/admin/dashboard`, `/admin/users`, `/admin/currencies`, `/admin/economy-grants`,
  `/admin/level-system`, `/admin/daily-bonus`, `/admin/hourly-wheel`,
  `/admin/daily-missions`, `/admin/difficulties`, `/admin/rtp-analytics`,
  `/admin/board-themes`, `/admin/lobby-features`, `/admin/shop`,
  `/admin/admin-access`. Index and `*` redirect to `/dashboard`.
  (`Admin.tsx:168-170, 235-237`)
- A "Tables / Rooms" (`kind='standard'`) section was removed as dead UI.
  (`Admin.tsx:145-148`)

## 4. Operator workflows per domain

- **Dashboard** (`features/Dashboard/`): five headline cards (users, suspended,
  matches, active matches, game config, shop items) + first 6 rows of the audit
  feed + readiness notes. Owns `getDashboardStats`; subscribes to other features'
  caches. (`DashboardAdmin.tsx:32-60`)
- **Users** (`features/Users/`): directory of latest 120 profiles with wallets,
  per-user inspector (wallet, last 12 transactions, boards, purchases, matches),
  online-presence widget, profile edits, suspend/unsuspend, `admin_adjust_wallet`
  RPC, soft delete, hard delete via `admin_hard_delete_user` RPC with
  type-to-confirm. (`UsersData.ts:45-223`)
- **Admin Access** (`features/AdminAccess/`): role table + allowlist CRUD, audit
  feed. "Cannot delete your own email" is a UI-only guard.
  (`AdminAccessAdmin.tsx:169,287`)
- **Currencies** (`features/Currencies/`): read-only table list + upsert through
  `admin_upsert_currency_config`; no deletes exposed (disable instead).
- **Economy Grants** (`features/EconomyGrants/`): catalog CRUD through
  `admin_upsert_economy_grant`.
- **Daily Bonus** (`features/DailyBonus/`): per-day row upserts against
  `daily_bonus_configs`.
- **Hourly Wheel** (`features/HourlyWheel/`): singleton `wheel_configs` id `main`
  - row-per-wedge `wheel_slots` upserts; basis-point chances must sum to 10000,
    visualized pre-save.
- **Daily Missions** (`features/DailyMissions/`): mission template + reward
  bundles, `mission_type_config` coefficient edits, chest milestones + rewards,
  reroll-pricing singleton, streak-chest bundle, `admin_refresh_player_missions`
  by email, and a full `simulate_*` test harness.
  (`DailyMissionsData.ts:304-377, 551-722`)
- **Difficulties** (`features/Difficulties/`): `table_configs` upserts for
  `kind='difficulty'` tiers.
- **RTP Analytics** (`features/RTPAnalytics/`): per-tier summary + per-player
  drill-down with 24h/7d/30d/all ranges; expands a tier to load top-50 players,
  deep-links into `/users` with the profile pre-selected.
  (`Admin.tsx:52-54, 187-191`)
- **Board Themes** (`features/BoardThemes/`): `board_theme_configs` CRUD +
  restore built-in seeds, podium image library, loading-screen library.
- **Lobby Features** (`features/LobbyFeatures/`): editable subset
  (`label, unlock_level, is_enabled, tooltip_text, sort_order`) of
  `lobby_feature_configs`.
- **Shop** (`features/Shop/`): `shop_items` CRUD, global `store_sales` (bonus %)
  single row, `store_config` singleton.

## 5. Config ownership and live-editable values

All configuration is DB-resident and edited at runtime through the BO;
migrations seed idempotently. `updated_by` is stamped from the operator id on
every config write. Currency values are the single source of truth for $/EV
math: `currency_configs.usd_value_micros`. (`20260702000000_currency_configs.sql:11-28`)
`Admin.tsx:94-99` builds the shared rate map via `buildCurrencyRateMap`, fed to
reward-config panels (XP is intentionally not seeded/priced).

Live-editable surfaces: level curve (`level_configs` + `level_status_tiers`,
batch apply with cap + `recompute_player_levels`), table/tier fees and
`target_rtp_pct`, shop items/sale/storefront, daily bonus days, wheel wedges,
mission templates/coefficients/chests/reroll pricing, board themes/podiums/
loading screens, lobby feature toggles, economy grant rules, currency values.

## 6. Reporting: RTP, users, audit log

- **RTP:** `get_rtp_summary` (per-difficulty-tier played/won/win-rate/wagered/
  paid-out/house-net/actual-RTP/delta-vs-target/risk-free-count, optional
  `p_since`); `get_rtp_per_player` (top-50, capped 200). Computed server-side
  from `matches` + `wallet_transactions`.
- **Users:** Dashboard stats counts. Note: "Users" counts non-deleted rows within
  the latest-120 window, deliberately mirroring legacy behavior — NOT a true head
  count. (`DashboardData.ts:35-38`)
- **Audit log:** `admin_audit_log` table written by
  `private.log_admin_config_change()` trigger. Read as a 20-row feed shared by
  Dashboard (first 6) and Admin Access. Trigger coverage exists for:
  `admin_roles`, `level_configs`, `table_configs`, `board_theme_configs`,
  `shop_items`, `admin_email_allowlist`, `economy_grants`, `podium_images`,
  `loading_screen_images`, `level_status_tiers`. **Missing** for:
  `daily_bonus_configs`, `wheel_configs`/`wheel_slots`, `currency_configs`,
  `lobby_feature_configs`, `store_sales`, `store_config`, and all Daily Missions
  tables.

## 7. Admin app structure: store, injected endpoints, data modules

The RTK Query migration is complete. All 14 feature folders contain their own
`<X>Api.ts` and `<X>Data.ts` (plus `<X>Admin.tsx`; AdminAccess also has
`AdminAuthGate.tsx`). No `loadAdminData`-style legacy loaders remain — every data
fetch goes through `adminBaseApi.injectEndpoints` in the feature's Api module.

- `store/store.ts:1-11` — `createAdminStore` with only the `adminApi` reducer;
  default middleware + `adminBaseApi.middleware`.
- `store/baseApi.ts:1-38` — single `createApi` on `fakeBaseQuery<AdminApiError>()`,
  `reducerPath: "adminApi"`, 17 declared tagTypes, plus `toAdminApiError()`
  normalization.
- `store/hooks.ts:1-4` — typed `useAdminDispatch`/`useAdminSelector`.
- `Admin.tsx:36-49` — `migratedFeatureTags` list powers the global Refresh via
  `adminBaseApi.util.invalidateTags`; inactive cached results are dropped, so
  they refetch on next mount. `Admin.tsx:55-66` tracks `isFetching` across
  `state.adminApi.queries` for the Refresh button state.
- Per-domain tags confirmed across all Api modules (e.g. Shop has separate
  `Shop`/`StoreSales`/`StoreConfig` tags; BoardThemes splits
  `BoardThemes`/`BoardThemesPodiums`/`BoardThemesLoadingScreens`).
- No client barrel files; imports are direct module paths.

## 8. Local development and deployment

- `pnpm run dev:admin` — Vite on `http://127.0.0.1:5175`, `base: "/admin/"`,
  `outDir: dist/admin`, publicDir from `packages/brand-assets/public`.
- `pnpm run build:admin` (tsc + vite build); `pnpm run build:all` runs boundary
  check + game + admin + website. All builds need `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Deployment: single nginx site — `dist/admin` served under `/admin`; game
  `dist/play` is Capacitor-only, not web-served.
- Auth: independent Supabase client with `storageKey: "sb-admin-auth-token"`,
  PKCE, `detectSessionInUrl: true`. OAuth callback at `/admin/auth/callback`;
  the admin origin's callback URL must be in the Supabase Auth redirect
  allowlist. Session isolation from the game client is deliberate — operators can
  be logged into the game and BO simultaneously. Re-auth as a different operator
  resets the admin RTK Query cache. (`AdminAuthProvider.tsx:63-73`)
- First owner bootstrap: `insert into admin_roles (profile_id, role, note)
values ('<uuid>','owner',...)` or rely on the seeded allowlist entry.
- Migrations live in `supabase/migrations/` (single directory, shared with the
  game schema).

## 9. Known gaps and open decisions

- **Users directory capped at 120** and the Dashboard "Users" card counts that
  window, not the true total — documented as intentional parity.
- **Audit log** is a fixed 20-row feed with no pagination/filtering; several
  config tables have no audit triggers (section 6).
- **Wheel write gate is `is_admin` (any role)** at the DB while every other
  config table and the UI use `can_manage_config` (owner/admin) — inconsistency.
- **RTP Analytics is untagged** — the global Refresh button does not invalidate
  it; it has its own per-section refetch instead.
- **`test_purchase_shop_item`** RPC exists for validating draft shop offers but
  is not wired into the Shop UI.
- **Non-atomic multi-step saves** in Daily Missions (template/reward,
  chest/reward, streak bundle are delete-then-insert sequences that can fail
  partway). (`DailyMissionsData.ts:304-377, 531-551`)
- **"Cannot delete your own email"** is a UI-only rule, not enforced in the DB.
- **Missions tables are not in the generated `Database` type** — Daily Missions
  uses locally declared interfaces over a cast client, kept because a types regen
  would drop hand-patched phantom columns. (`DailyMissionsData.ts:8-15, 218-274`)
- **LevelSystem legacy fallback:** `upsertLevelConfig` retries without
  `status_label` for older schemas; `deleteLevelConfigsAboveCap` guards against
  unsafe caps. (`LevelSystemData.ts:96-133`)
- **RTP/Users cross-section state** (`selectedUserId`, `rtpRange`, expanded tier)
  lives in `Admin.tsx`, not in the features, to survive navigation.
- **Soft delete leaves auth.users rows**; hard delete exists specifically to
  purge shell/test users that pile up during dev.
  (`20260701000000_admin_hard_delete_user.sql:4-12`)

### Carried-forward live items (from the archived router plan)

- **Optional lazy loading:** `lazy()` the 14 feature imports with one
  `<Suspense>` around the section `<Routes>` is still optional and not done.
- **`/users/:userId` deep link:** reading `selectedUserId` from `useParams` so a
  single user is deep-linkable is still optional and not done.
