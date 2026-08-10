# Back Office router plan

Goal: replace the in-memory `activeSection` switch in `apps/admin/src/Admin.tsx`
with real URLs, so sections are deep-linkable, survive reload, and work with
browser back/forward.

Status: Phase 1 routing is implemented. Phase 2 (optional lazy loading and user
deep links) is still pending. The Redux follow-up is implemented: the independent
admin store and `adminBaseApi` live in `apps/admin/src/store/`, and Currencies,
Lobby Features, Economy Grants, Daily Bonus, Hourly Wheel, Level System,
Difficulties, Board Themes, Dashboard, Users, RTP Analytics, Admin Access, and
all seven Daily Missions UI domains (Templates, Mission Types, Chests, Reroll,
Streak Chest, Refresh Tool, Simulator) are migrated end to end via RTK Query.
Nothing is pending — Shop was the last feature.

## Pre-migration baseline — `activeSection` state

> Legacy snapshot, kept for history. The implemented shell no longer routes
> sections through `activeSection` state: `Admin.tsx` derives the section from
> the URL via `useLocation()` and the explicit section registry in
> `lib/adminSections.ts`, and the nav sidebar renders `<NavLink>`s from that
> same registry (see "Phase 1 — URL routing" below). The bullets below record
> the pre-migration layout.

- `apps/admin/src/App.tsx` already mounts `BrowserRouter basename="/admin"` with
  two routes: `/` → `Admin`, `/auth/callback` → `AdminAuthCallback`, plus a
  catch-all `Navigate` to `/`.
- `Admin.tsx` is a single 2363-line component. `activeSection` is
  `useState<Section>("Dashboard")` at line 262.
- `activeSection` is written in exactly 2 places:
  - line 2034 — nav sidebar button `onClick`.
  - line 2260 — RTP Analytics `onOpenUser`, which also sets `selectedUserId`.
- `activeSection` is read in 8 places: 351 (`useOnlineUsersWatcher`), 618 (Board
  Themes lazy load), 625 (Lobby Features lazy load), 973 and 1007 (RTP loads),
  2032 (nav styling), 2044 (topbar label), 2062-2363 (14 render conditionals).
- No persistence. There is no localStorage, hash, or query-string read or write.
  A reload always lands on Dashboard.
- Hosting is already correct. `nginx.conf:74-78` maps `/admin/*` to
  `/admin/index.html`. No deploy change is needed.
- The access gate at `Admin.tsx:1972-2009` returns before the shell. It guards
  every section today and must keep guarding every route.

## Phase 1 — URL routing

Mechanical change. Props and handlers stay identical. No state is lifted.

### 1. New file `apps/admin/src/lib/adminSections.ts`

- Move `type Section` (currently `Admin.tsx:90-104`) here. Export it. The type is
  not imported anywhere else, so the move is safe.
- Export the section registry. It replaces the `sections` const
  (`Admin.tsx:127`), which is a plain string array with no route metadata.

```ts
export type Section = "Dashboard" | "Users";
/* … 14 entries, unchanged … */

export const adminSections: readonly { label: Section; path: string }[] = [
  { label: "Dashboard", path: "dashboard" },
  { label: "Users", path: "users" },
  { label: "Currencies", path: "currencies" },
  { label: "Economy Grants", path: "economy-grants" },
  { label: "Level System", path: "level-system" },
  { label: "Daily Bonus", path: "daily-bonus" },
  { label: "Hourly Wheel", path: "hourly-wheel" },
  { label: "Daily Missions", path: "daily-missions" },
  { label: "Difficulties", path: "difficulties" },
  { label: "RTP Analytics", path: "rtp-analytics" },
  { label: "Board Themes", path: "board-themes" },
  { label: "Lobby Features", path: "lobby-features" },
  { label: "Shop", path: "shop" },
  { label: "Admin Access", path: "admin-access" },
];
```

The label stays the display string. Do not derive the slug from the label at
runtime; an explicit map keeps URLs stable if a label changes.

### 2. `apps/admin/src/App.tsx`

- Change the Admin route from `path="/"` to `path="/*"`. This lets `Admin` host
  descendant routes.
- `/auth/callback` is a static path. React Router v7 ranks it above the splat, so
  the OAuth callback still matches. Route order does not matter.
- Delete the `path="*"` → `<Navigate replace to="/"/>` route. The splat now
  covers every path, and `Admin` redirects unknown sections itself.

### 3. `apps/admin/src/Admin.tsx`

- Delete `type Section` (90-104) and `const sections` (127). Import both from
  `./lib/adminSections`.
- Line 262: delete the `useState`. Derive the value from the URL:

```ts
const location = useLocation();
const navigate = useNavigate();
const activeSection = useMemo(
  () =>
    adminSections.find((section) => location.pathname === `/${section.path}`)
      ?.label ?? "Dashboard",
  [location.pathname],
);
```

`location.pathname` excludes the basename, so it reads `/dashboard`, not
`/admin/dashboard`. All 6 remaining read sites keep working with no edit. The
4 section-gated load effects (618, 625, 972, 1005) compare the same strings, so
they fire on navigation exactly as they fired on section change.

- Nav aside (2030-2037): replace `<button onClick={setActiveSection}>` with
  `<NavLink to={`/${section.path}`}>`. Reuse the existing class strings through
  `className={({isActive}) => …}`.
- RTP deep link (2259-2262): replace `setActiveSection("Users")` with
  `void navigate("/users")`. Keep `setSelectedUserId(profileId)`.
- Lines 2062-2363: wrap the 14 `{activeSection === "X" && <XAdmin …/>}` blocks in
  a descendant `<Routes>`. Each block becomes a `<Route>` with the same element
  and the same props:

```tsx
<Routes>
  <Route element={<Navigate replace to="/dashboard" />} index />
  <Route
    element={<DashboardAdmin audit={audit} cards={dashboardCards} />}
    path="dashboard"
  />
  {/* … 13 more, props unchanged … */}
  <Route element={<Navigate replace to="/dashboard" />} path="*" />
</Routes>
```

Child `path` values are relative to the parent match at `/`. The `to` value in
`Navigate` is absolute and the basename prefixes `/admin` automatically.

### Untouched by Phase 1

- The access gate (1972-2009) and the `accessState` effect (658-736).
- `loadAdminData` (777-938) and its mount effect (940-941).
- All 19 save and delete handlers.
- `useConfirm` and `confirmUI`, `useOnlineUsersWatcher`, `savingKey`, `dataError`.

### Verification

1. `pnpm run dev:admin`, then hard-reload `http://127.0.0.1:5175/admin/board-themes`.
   The Vite SPA fallback must serve the shell with `base: "/admin/"`.
2. Browser back and forward switch sections.
3. OAuth round trip: sign in, land on `/admin/auth/callback`, get redirected to
   `/` and then to `/admin/dashboard`.
4. RTP Analytics → click a player → lands on `/admin/users` with the user selected.
5. `pnpm run lint`.

### Size

1 new file, 3 edited files, about 60 changed lines.

## Phase 2 — optional, separate change

- `/users/:userId`. Read `selectedUserId` from `useParams`. `selectUser`
  navigates instead of setting state. This removes the last cross-section state
  pair and makes a single user deep-linkable.
- `lazy()` the 14 feature imports (`Admin.tsx:14-27`) with one `<Suspense>`
  around the section `<Routes>`. Today all 14 feature modules (about 6300 lines)
  ship in the Admin chunk.

## Rejected for now

- Nested routes in `App.tsx` with `<Outlet context={…}>`. Every feature component
  takes 15-25 props from `Admin` state, so the outlet context would carry about
  100 fields. This is only worth doing after `Admin.tsx` state is split per
  feature.
- `createBrowserRouter` / data router. There are no loaders or actions.

## Follow-up: Redux in the Back Office

Routing is a prerequisite for this, not a competitor. Once each section is a
route, a feature can own its data without touching its siblings.

Status: implemented. `apps/admin/src/store/` has its own `store.ts`
(`createAdminStore`, reducer path `adminApi`), `baseApi.ts` (`adminBaseApi` on
`fakeBaseQuery`), and typed `hooks.ts`; `main.tsx` mounts the admin `<Provider>`.
Feature endpoints inject into `adminBaseApi` from `features/<X>/<x>Api.ts`.
Migrated end to end (each feature owns `<X>Admin.tsx`, `<x>Api.ts`,
`<x>Data.ts`): Currencies, Lobby Features, Economy Grants, Daily Bonus, Hourly
Wheel, Level System, Difficulties, Board Themes, Dashboard, Users, RTP
Analytics, Admin Access, and all seven Daily Missions UI domains — Templates, Mission
Types, Chests, Reroll, Streak Chest, Refresh Tool, and Simulator. Nothing is
pending — Shop was the last feature.

Structural note: the `admin_audit_log` read is owned by the Admin Access feature
endpoint (`getAuditLog` in `AdminAccessApi.ts`). It is shared with the Dashboard
section, which subscribes to the same cache key from its own component — RTK
Query dedupes, so this is not a second server call. Keeping the endpoint in
Admin Access is intentional: both sections render the same feed and both own
write paths that invalidate the tag.

RTP Analytics keeps only its selected range and expanded tier in `Admin.tsx`.
These are route UI state, not server data. Keeping them in the mounted shell
preserves the existing values when an operator leaves and returns to the route;
the feature owns both RPC reads through RTK Query.

Difficulties keeps no state in `Admin.tsx`. The tier table read is owned by
`DifficultiesApi.ts` and shared with the Dashboard section, which subscribes to
the same cache key from its own component (RTK Query dedupes, so this is not a
second server call) to derive the "Game config" count — the count stays live
after saves without a second server call.

Board Themes keeps no state in `Admin.tsx` either. The route owns three data
domains — `board_theme_configs`, `podium_images`, `loading_screen_images` —
each with its own tag (`BoardThemes`, `BoardThemesPodiums`,
`BoardThemesLoadingScreens`) so a write refetches only the domain it changed,
mirroring the old per-domain `loadX(successMessage)` refreshes. The board
grid read is shared with the Dashboard section the same way as the tier read
(see Difficulties above). All drafts (board/podium/loading-screen), the editor
modal state, and the success banner are local feature state; per-action busy
flags replace the old shared `savingKey`.

Dashboard keeps no state in `Admin.tsx` and no longer reads through `stats`
state at all: `AdminStats`, `dashboardCards`, and the four head-count legs of
`loadAdminData`'s Promise.all are gone. `DashboardData.ts` owns a single
summary query (`getDashboardStats`) that preserves the legacy counts exactly,
including the "Users" card's quirk of counting only the latest 120 profiles.
The section subscribes to the shared caches it needs (audit via Admin Access,
tables/boards/levelConfigs for the "Game config" count) with RTK Query dedupe,
and `refetchOnMountOrArgChange` preserves the old "fresh counts when the
section opens" behavior. The parent-level subscriptions `Admin.tsx` had added
for Dashboard's sake (audit, levelConfigs, tables, boards) are removed; only
`currencies` remains (shared rate map).

Users is the last large feature. `UsersAdmin` owns the directory list query
(`getUsers` — the latest 120 profiles with wallets attached, deleted rows
filtered), the per-selection inspector query (`getUserDetail` — wallet,
ledger, inventory, purchases, matches), the online presence widget
(`useOnlineUsersWatcher(true)` — it mounts only while the route is active, the
same gating as the old `activeSection === "Users"` flag), the drafts
(profile/wallet), the checked-selection helpers, and both delete flows with
their own `useConfirm` (soft delete with the legacy missing-columns fallback,
hard delete via the `admin_hard_delete_user` RPC loop). All five mutations
share a single `Users` tag so a write refetches the list row and the open
inspector together, mirroring the old `await loadAdminData()` refresh. The one
piece of Users UI state left in `Admin.tsx` is `selectedUserId`: the RTP
Analytics deep link writes it before navigating to `/users`, so it must
survive section navigation. The feature reports row clicks and delete-clears
back through `onSelectedUserIdChange` and falls back to the newest user when
the deep-linked id is no longer in the latest-120 list (the old
`loadAdminData` restore behavior). `loadAdminData` is gone entirely — after
Shop, the shell no longer reads section data from Supabase directly.

Shop keeps no state in `Admin.tsx` either. The route owns three data domains
— `shop_items`, `store_sales` (the global Store Sale), `store_config`
(storefront appearance) — each with its own tag (`Shop`, `StoreSales`,
`StoreConfig`) so a write refetches only the domain it changed, mirroring the
old per-domain legs of `loadAdminData`. The feature seeds its sale/config
drafts from the query rows (the old loader re-seeded them on every load), and
the four writes reset/reload exactly like the old handlers: saving or deleting
an item resets the item draft, saving the sale re-seeds its draft from the
refetched row (so a brand-new sale gets its new id). `savingKey` became the
feature's `pendingKey` with the same strings (`"shop"`, `"store-sale"`,
`"store-config"`, `"shop-delete"`), and the item delete keeps its confirm
dialog via the feature's own `useConfirm`. The store_sales/store_config reads
fail silently on purpose — the legacy loader only threw on `shop_items`, so
only that read surfaces through `onError`. The global Refresh button is now
pure invalidation: it dispatches `invalidateTags(migratedFeatureTags)` and
drains through the shared cache — the button shows "Refreshing…" from the
click until no query in the cache has a request in flight (the old
`loadAdminData` in-flight flag had no equivalent once the last legacy read
disappeared).

Measured cost:

- Infra is about 120 lines, copied from `apps/game/src/store/` (`store.ts` 34,
  `baseApi.ts` 21, `hooks.ts` 6; the game store's `listenerMiddleware.ts` is not
  part of the admin copy). Admin needs its own `adminBaseApi` bound to
  `adminSupabase`. The two stores share no code.
- Listener middleware remains optional/future work: the completed RTK Query
  migrations do not require it and none introduced it — there is no
  `listenerMiddleware.ts` under `apps/admin/src/store/`. Admin has no timers or
  Realtime except `useOnlineUsersWatcher`, which stays a hook.
- About 32 queries and 48 mutations. At the pre-migration baseline the Supabase
  calls existed inline (35 call sites in `Admin.tsx`); they moved to
  `features/<X>/<x>Data.ts` and got wrapped in `<x>Api.ts`.
- `Admin.tsx` is down from 2363 lines to about 500. It no longer reads
  section data directly: what remains is the shell (access gate, header/nav,
  global Refresh, routes), the shared currencies rate-map query, and the RTP
  route state.
- Feature components grow 20-60 lines each as they call their own hooks.
- Total churn is about 2500 lines across about 30 files.

Keep out of Redux: most of the 61 `useState` in `Admin.tsx` are form drafts
(`currencyDraft`, `boardDraft`, `shopDraft`, `tierDrafts`, `emailRoleDraft`).
They stay local `useState` in the feature component. Only server data goes into
RTK Query.

Risks:

1. No test net. `vitest.config.ts` is scoped to `packages/**` and AGENTS.md
   forbids testing client code. A wrong invalidation tag shows stale data with no
   error. This is the main risk and it is per-endpoint.
2. AGENTS.md rule 5 named `apps/game/src/store/` as the store. Resolved: AGENTS.md
   now describes the game store and the independent admin store separately.
3. `savingKey` is one global busy string read at about 19 disable sites. RTK Query
   replaces it with per-mutation `isLoading`. Every site must be rewired.

Cheaper alternative: split `loadAdminData` into per-section loaders and move state
into each feature component with plain `useState` and `useEffect` — the shape
`HourlyWheelAdmin` and `MissionsAdmin` already use. That removes prop drilling and
the 16-table refetch at roughly 40% of the cost, with no new library. What it
loses is cache between navigations and request dedupe, which matter little for an
internal tool.

Recommended order, followed during the migration (steps 1-2 done; step 3 applied
one feature per change). The argument is consistency with the game app, not
performance:

1. Phase 1 routing.
2. Migrate `Currencies` end to end (104 lines, 1 table, 1 mutation). Ship it and
   confirm the pattern.
3. Migrate the rest, one feature per change. Do `Users` and `Shop` last —
   they hold the deep link and the most drafts. Both are now done; the
   migration is complete.

Do not migrate all features in one change.
