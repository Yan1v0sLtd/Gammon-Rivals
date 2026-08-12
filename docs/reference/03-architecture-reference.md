# Architecture Reference

> Reference · As-built · Owner: Yaniv · Compiled as-of: 2026-08-10

Describes the structure of the Gammon Rivals monorepo: repository layout,
boundary rules, engine/AI purity, client state rules, backend surface, delivery,
and testing policy. It describes structure, not player flows. Player flows live
in `docs/reference/04-online-play-reference.md`.

## 1. Scope and audience

For developers and operators who need to know where code lives, what may import
what, and how the system is delivered. The rule authority is `AGENTS.md`; this
reference restates structure with source citations.

## 2. Repository layout

Monorepo with `apps/`, `packages/`, `supabase/`, `scripts/`, `config/`, plus a
checked-in `android/` native shell.

- `apps/game/` — player app, Capacitor-only, NOT web-served. Subdirs: `game/`
  (React session state), `board/` (board data adapters), `store/` (Redux + RTK
  Query API), `features/` (per-feature vertical slices), `components/`,
  `pages/`, `lib/` (infrastructure only). (`AGENTS.md:44-60, 63-67`)
- `apps/admin/` — independent Back Office, web-served under `/admin`. Same
  shape (`store/`, `features/`, `components/`, `lib/`). (`AGENTS.md:69-76, 148`)
- `apps/website/` — Astro marketing/legal site, web-served at domain root.
  (`apps/website/astro.config.mjs:29-37`)
- `packages/`: `engine/` (pure rules), `ai/` (pure decision logic + Worker
  bridge), `sim/` (headless economy/AI-ladder), `board-renderer/` (shared Pixi),
  `board-preview/` (admin board preview), `brand-assets/` (shared asset
  sources), `shared/` (DB types + pure utils). (`AGENTS.md:76-79, 85-87`)

`packages/` is shared logic; `apps/` is UI and client state. Nothing in
`packages/` may import `apps/`. (`AGENTS.md:89`)

## 3. Boundary rules and the boundary checker

`scripts/check-app-boundaries.mjs` scans `.ts/.tsx` under 8 roots and enforces:

- No client index/barrel re-export modules. (`check-app-boundaries.mjs:33-39`)
- game↔admin isolation: game may not reference `apps/admin` or
  `VITE_ADMIN_APP_URL`; admin may not reference game. (`check-app-boundaries.mjs:40-51`)
- admin may not import `packages/engine/` or `packages/board-renderer/` — it
  must use `board-preview`. (`check-app-boundaries.mjs:52-57`)
- `packages/` may not import `apps/`. (`check-app-boundaries.mjs:58-60`)
- `shared/` and `engine/` are confined to their own package.
  (`check-app-boundaries.mjs:68-73`)
- **Pure-package contract:** `ai` (allowed: ai + engine) and `sim` (allowed:
  sim + ai + engine) must stay dependency-free — bare npm specifiers are
  rejected. (`check-app-boundaries.mjs:14-20, 99-111`) A stray npm import would
  land server-side in the Deno mirror and fail at runtime with no local build
  error. (`check-app-boundaries.mjs:95-98`)

Run via `pnpm run check:boundaries`, wired into `build:all` before all builds.
(`package.json:12, 17`)

## 4. Engine and AI purity, plus the Deno mirrors

- Engine is pure, deterministic, serializable TS; `applyMove` returns a new
  `BoardState`; `legalMoves(state, remainingDice)` generates all legal sequences
  up front; `legalMoves` returns `[]` when both dice are unusable.
  (`AGENTS.md:6-11, 121-131`)
- Dice are server-authoritative online; the seeded `Rng` in `dice.ts` is for
  local play and tests only. (`AGENTS.md:13-16`)
- AI is pure decision logic; `ai/client.ts` + `ai/worker.ts` are the browser-only
  Worker bridge exception. (`AGENTS.md:91-94`)
- `scripts/build-shared-engine.mjs` copies `packages/engine/src` verbatim into
  `supabase/functions/_shared/engine/`, rewrites relative specifiers to explicit
  `.ts` (Deno requirement), drops tests, regenerates a barrel.
  (`build-shared-engine.mjs:14-21, 43-66`)
- `scripts/build-shared-ai.mjs` mirrors `packages/ai/src` into
  `supabase/functions/_shared/ai/`, excluding `client.ts`/`worker.ts` and tests.
  (`build-shared-ai.mjs:22-31, 56-67, 76-93`)
- Both mirrors are marked "GENERATED FILE — DO NOT EDIT"; regenerate with
  `pnpm run build:shared-engine` / `build:shared-ai`.

## 5. Client state rules

- Separate Redux apps; no shared store. `apps/game/src/store/store.ts:1-24`
  configures the store with default middleware (immutable + serializable checks
  intact), reducer map = `api` (RTK Query) + 6 slices (auth, replay, appUi,
  lobby, gameplay, onlineMatch), listener middleware prepended.
  (`AGENTS.md:143-174`)
- Single shared API: `apps/game/src/store/baseApi.ts:14-24` — `createApi` on
  `fakeBaseQuery<ApiError>()`; features inject endpoints, never a second
  `createApi`. (`baseApi.ts:1-12`)
- RTK Query results are never copied into slices; slices hold only serializable
  UI state; query data read via `createSelector`. (`AGENTS.md:153-156, 161-164`)
- Listener middleware: `apps/game/src/store/listenerMiddleware.ts:1-24` is a
  composition root registering `start<Feature>Listeners(startListening)`;
  components never own timers/polling; workflows cancelled by dispatching a
  matched control action. (`AGENTS.md:157-161`)
- One `<Provider>` at root; typed hooks from `store/hooks.ts`; no barrels.
  (`AGENTS.md:165-166`)
- Admin: `apps/admin/src/store/store.ts:1-18` — `createAdminStore()`, reducer is
  only `adminApi`; `apps/admin/src/store/baseApi.ts:14-26` — `adminBaseApi` on
  `fakeBaseQuery<AdminApiError>`, 18 tag types.

## 6. Backend surface

### Edge functions (`supabase/functions/`)

- `_shared/engine/` and `_shared/ai/` — generated Deno mirrors (section 4).
- `roll_dice/` — server-authoritative dice for online matches. Authenticates
  caller JWT, runs all DB work as service role; enforces owner/opponent + turn
  checks; handles multi-game match continuation; crypto RNG dice; writes
  `current_turn`. (`roll_dice/index.ts:1-33, 55-73, 120-145, 172-200`)
- `finish_turn/` — server-authoritative turn commit. Replays recorded moves
  through the engine mirror, validates every sub-move against `legalMoves`,
  derives true outcome, then calls `commit_turn_server` RPC under service role.
  Illegal submove → 422, nothing committed. Supports `dryRun`.
  (`finish_turn/index.ts:1-46, 100-190, 260-300`)
- `ai_move/` — server-authored AI turn for bot matches. Header states it is
  dormant: "NOT yet wired into the live AI match flow (HotSeat plays the AI
  client-side today)." (`ai_move/index.ts:1-13`)
- `validate_game/` — SHADOW validator, read-only/non-enforcing; replays recorded
  moves and compares derived vs recorded outcome. (`validate_game/index.ts:1-18, 130-165`)
- `validate-google-purchase/` — Play purchase validation: JWT → profile,
  resolves `shop_items.google_product_id`, verifies token with Google Play
  Developer API, calls `fulfill_google_purchase` RPC (service_role, idempotent).
  Contains TEMP debug writes to `billing_debug_log`.
  (`validate-google-purchase/index.ts:1-40, 91-135, 178-220`)

### RPC groups, RLS, and admin gates

- Admin roles: `public.admin_roles` (owner/admin/support/viewer) +
  `public.admin_email_allowlist` (email-based bootstrap).
  (`20260511140413_admin_foundation.sql:9-16, 26-38, 47-54`;
  `20260514070817_admin_email_allowlist.sql:1-46`)
- Gate helpers in `private` schema: `private.current_admin_role()`,
  `private.is_admin()`, `private.can_manage_config()` (owner/admin only), all
  `security definer`. (`20260514070817_admin_email_allowlist.sql:47-88`)
- Server-only RPCs: `commit_turn_server` (`20260712000000`) — atomic 3-write
  (INSERT moves + UPDATE games + UPDATE matches), `security definer`, takes
  `p_caller_id`, `SELECT ... FOR UPDATE` row lock, granted service_role only.
  (`20260712000000_commit_turn_server_rpc.sql:38-132, 141-144`) `commit_ai_turn`
  (`20260716000000`) likewise.
- Online record lock: client INSERT/UPDATE on `moves`/`games` restricted to
  non-online matches; online (PvP) games/moves writable only by server.
  (`20260713000000_lock_online_game_record.sql:1-28, 36-59`)
- Grant hardening: revoke EXECUTE from anon for 18 server-only fns; 4 pure
  pg_cron fns also revoked from authenticated.
  (`20260711000000_revoke_server_fn_grants.sql:14-44`)
- RLS read gates: matches/games/moves readable by admin, participants, or
  (matches) when finished. (`20260511140413_admin_foundation.sql:488-525`)
- Admin analytics RPCs: `get_rtp_summary` (admin-only).
  (`20260604000000_rtp_summary_rpc.sql:39-44, 141-144`)

## 7. Delivery

- **dist/play → Capacitor:** `capacitor.config.ts:19-24` — `webDir: 'dist/play'`,
  no `server.url` (`/play` is not web-served). appId `com.gammonrivals.app`.
  (`capacitor.config.ts:5-9, 25-36`) `apps/game/vite.config.ts:27-35` —
  `outDir: dist/play`. Any change requires `pnpm run android:sync` + APK
  reinstall.
- **dist/admin → /admin:** `apps/admin/vite.config.ts:27-35` — `base: "/admin/"`,
  `outDir: dist/admin`. The nginx site config `gammonrivals.com.conf` serves the
  admin SPA under `/admin/`, deep links fall back to `/admin/index.html`.
  (`gammonrivals.com.conf:21-30`)
- **dist/web → root:** Astro site is document root; clean URLs via `try_files`.
  (`gammonrivals.com.conf:33-35`)
- Game (`dist/play`) is deliberately NOT served by the web server; the config
  has no `/play` route.
- Shared brand assets: all three apps use `publicDir: packages/brand-assets/public`.
  (`apps/game/vite.config.ts:13`; `apps/admin/vite.config.ts:13`;
  `astro.config.mjs:27`)

## 8. Testing policy

- `vitest.config.ts` scoped to `packages/**/*.{test,spec}.ts` only; comment
  forbids widening to `apps/**`. (`vitest.config.ts:7-16`)
- "Packages are tested; apps are not." (`AGENTS.md:178`) Covered: engine rules,
  AI decision logic, economy sim, board hit-area geometry. Guard rails:
  `fuzz.test.ts` (legalMoves/applyMove invariant) and `hit-areas.test.ts` (click
  routing). (`AGENTS.md:180-184`)
- Browser code inside `packages/` (Pixi renderer, `ai/client.ts`, `ai/worker.ts`)
  is untested, same as `apps/`. Client tests were removed deliberately; do not
  add back without discussion. (`AGENTS.md:185-188`)
- `pnpm run sim` → `packages/sim/src/runSim.ts`; `SIM_GAMES=4000` for longer
  runs. (`AGENTS.md:192-193`)

## 9. Known structural debt

- **ai_move edge function is dormant** — server-authoritative AI built and
  committed but not wired into live matches; HotSeat still plays the AI
  client-side. (`ai_move/index.ts:1-13`)
- **validate_game is a shadow (non-enforcing) tool** — read-only; enforcing
  validate-and-commit path is a planned later slice. (`validate_game/index.ts:1-18`)
- **finish_turn (old client-callable RPC) left in place** as rollback path after
  `commit_turn_server` replaced it; grant revoked but function not dropped.
  (`20260712000000_commit_turn_server_rpc.sql:1-13, 140-141`)
- **matches outcome columns not yet locked** — winner/scores left for a later
  integrity pass. (`20260713000000_lock_online_game_record.sql:27-33`)
- **Dropped-double (cube, target>1) game-end still client-direct** — outside the
  validated path. (`finish_turn/index.ts:41-46`)
- **TEMP debug table `billing_debug_log`** written from validate-google-purchase
  failure paths, marked "Remove once diagnosed."
  (`validate-google-purchase/index.ts:127-135, 185-194`)
- Admin data access is partly off-RTK-Query (direct `adminSupabase` calls in
  `AdminAccessData.ts`) — RTK Query is the stated single server cache but admin
  features do not uniformly inject endpoints into `adminBaseApi`.

## 10. Open decisions

- Wiring the dormant server-authoritative AI path (roll_dice + commit_turn_server
  for humans + ai_move for bots + derived payout) is stated as "the next slice".
  (`ai_move/index.ts:8-12`)
- Migrating the still client-trusted paths (dropped-double game-ends; AI/hotseat
  client-authored moves) onto server validation. (`finish_turn/index.ts:41-46`)
- Whether to delete (vs keep as rollback) the old `finish_turn` RPC once the new
  path is proven in prod. (`20260712000000_commit_turn_server_rpc.sql:12-13`)
- Refund/chargeback handling is deferred to a later "P4 Real-time Developer
  Notifications" slice; not implemented. (`validate-google-purchase/index.ts:30-34`)
