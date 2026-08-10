# Backgammon — Architecture & Working Notes

> Read this before making changes. Engine is pure TS and the source of truth — UI is a view of board state, not a place
> to put rules.

---

## Core design principle

**The engine is pure, deterministic, and serializable.** Given a `BoardState` and a dice roll, every legal move is
generated up front by `legalMoves()`. The UI never validates moves on click; it asks the engine what's legal and offers
those choices. This is what makes online play and AI possible without rewriting logic.

When adding a feature, ask: _does this belong in the engine (rules/state) or in the view (Pixi/React)?_ Mixing them is
the most common bug source.

---

## Non-negotiables

1. **The engine in `packages/engine/src/` is pure TypeScript.** No React, no Pixi, no Supabase. If you import any of
   those into engine code, you've made a mistake. Engine functions take `BoardState` in, return new `BoardState` out.
   Everything is immutable.
2. **Dice are server-authoritative in online play.** Phase 5 onward, clients NEVER roll their own dice. Edge Function
   generates the roll, writes it to the match record, broadcasts via Realtime. The seeded `Rng` in `dice.ts` is only for
   local play and tests.
3. **Pixi never holds game state.** `BoardRenderer` has an imperative `render(state)` API. It's a view function. If you
   find yourself storing turn/move/dice in Pixi code, stop.
4. **Stake/match-value framing, not bet/winnings.** Virtual chips only. No real-money chip purchases, no cash-out path.
   This keeps us out of "simulated gambling" regulatory territory.
5. **Application state lives in Redux Toolkit; server data lives in RTK Query.** `apps/game` and `apps/admin` are
   independent Redux applications, each with its own store and one RTK Query API; there is no shared store across apps.
   The game store (`apps/game/src/store/`) is the only place game app state lives, and its `baseApi.ts` is the one shared
   game RTK Query API — game features inject endpoints into it. `apps/admin` has its own Redux Toolkit store and a single
   admin RTK Query API under `apps/admin/src/store/`; admin features inject endpoints into that API. No other
   state/server-cache library (TanStack Query, Zustand, …), no form library, no `@pixi/react`. Ask before adding new
   libraries.
6. **Doubling cube needs a confirm step.** Single-tap cube offers caused user complaints in the reference app (Lord of
   the Board). Long-press or two-tap.
7. **No client barrel files or re-exports.** Import each source module directly.

---

## File structure

```text
apps/
├── game/src/                      → Player application — Capacitor-only, NOT web-served
│   ├── game/                      → React-side session state
│   ├── board/                     → Player board data adapters
│   ├── store/                     → Redux store, typed hooks, listener middleware, shared RTK Query API
│   ├── features/                  → Per-feature slices, endpoints, selectors, Supabase data access, listeners (one dir per feature)
│   ├── components/
│   ├── pages/
│   ├── lib/
│   ├── App.tsx
│   └── main.tsx
├── admin/src/                     → Independent Back Office application — web-served under `/admin`
│   ├── store/                     → Own Redux Toolkit store + single `adminBaseApi` RTK Query API
│   ├── features/                  → Per-feature admin UI, injected endpoints, Supabase data access
│   ├── components/
│   ├── lib/
│   ├── Admin.tsx
│   ├── App.tsx
│   └── main.tsx
└── website/src/                   → Astro marketing/legal site — web-served at the domain root
    ├── config/site.ts             → Company, contact, legal and marketing strings — never hardcode them in a page
    ├── layouts/                   → SiteLayout + LegalLayout shells
    ├── components/                → Header/footer, feature grid, board strip
    ├── pages/                     → index, how-to-play, about, support, legal, delete-account, 404
    └── styles/
packages/
├── engine/src/                    → Pure TypeScript rules and tests
├── ai/src/                        → Pure AI decision logic (picker/evaluator/strength) + Worker bridge
├── sim/src/                       → Headless economy + AI-ladder simulator (`pnpm run sim`)
├── board-renderer/src/            → Shared Pixi renderer and geometry
├── board-preview/src/             → Back Office board preview
├── brand-assets/                  → Shared stable/native/website asset sources (public/, native/, imported/)
└── shared/src/                    → Shared database types and pure utilities
```

The game is **Capacitor-only on the web**: its `dist/play` bundle is synced into
the native shell (`capacitor.config.ts` → `webDir: 'dist/play'`, no `server.url`)
and is **not** served from `gammonrivals.com` — there is no `/play` route. Admin
is web-served under `/admin`, and the Astro website (`dist/web`) is the document
root. `packages/brand-assets` is the shared asset source for all three: `public/`
(stable URLs), `native/` (app icon/splash masters), `imported/` (website-exclusive
imagery).

**`packages/` is shared logic; `apps/` is UI and client state.** Nothing under `packages/` may import from `apps/` —
`scripts/check-app-boundaries.mjs` enforces it. `engine`, `ai` and `sim` are additionally _dependency-free_: engine +
siblings only, no npm imports (the checker rejects bare specifiers there). That's what lets `build-shared-ai.mjs` mirror
`packages/ai/src` verbatim into a Deno edge function for server-side bots. Two exceptions to headlessness live in
`packages/`: `ai/client.ts` + `ai/worker.ts` (Web Worker bridge) and all of `board-renderer` (Pixi) — both are browser
code, and neither is tested.

**New page checklist:**

- Imports engine through a relative path to the specific module in `packages/engine/src`
- Uses primitives from `components/UI.tsx` — no custom buttons
- Added to `App.tsx` routes

---

## Documentation

The `docs/` folder is the documentation home. It is organized into:

- `docs/reference/` — durable product and system knowledge (product, missions,
  architecture, online play, economy, admin).
- `docs/runbooks/` — repeatable operator and developer procedures.
- `docs/tasks/` — unimplemented work items with problem statements and
  acceptance criteria.
- `docs/bugs/` — confirmed defects tracked for fixing.
- `docs/archive/` — historical documents, never cited as current facts.

Start at `docs/README.md` for the index and topic ownership. This file stays the
rule authority; the references describe structure and flows and link back here.

---

## Coordinate convention

- Points are indexed `0..23`.
- **White's home is `18..23`. Black's home is `0..5`.**
- **White moves low→high (idx +1). Black moves high→low (idx -1).**
- `bar` and `off` are separate slots on `BoardState`, not points.
- Bar entry: white enters at point `die - 1` (i.e. 0..5, black's home). Black enters at point `24 - die` (i.e. 18..23,
  white's home).
- Bear-off exit: white's "off" is past index 23 (target = from + die ≥ 24). Black's "off" is past index 0 (target =
  from - die ≤ -1).
- Pip count is anchored by `pipCount()`: distance for white = `24 - idx`, for black = `idx + 1`. Opening position pip
  count = 167 for both — that's the canonical sanity check.

If anything in the rules code seems backwards, run the engine tests first — they encode the convention authoritatively.

---

## Engine principles

- **Immutability**: `applyMove` returns a new `BoardState`. Never mutate.
- **Up-front legal moves**: `legalMoves(state, remainingDice)` returns every legal sequence the player could play. UI
  shows highlights based on this list.
- **Determinism**: Given (state, dice), there is one canonical board after applying a move. This is what makes replays
  and server validation work.
- **No exceptions for "obvious" cases**: Even if both dice are unusable, `legalMoves()` returns `[]` — UI handles the
  "skip turn" case.

---

## PixiJS integration rules

- One `<BoardCanvas>` component owns the Pixi `Application`. It mounts on a div ref.
- The renderer is an imperative class. React passes `BoardState` props; the canvas calls `renderer.render(state)` inside
  a `useEffect`.
- Animations (move, hit, dice roll, bear-off) are fire-and-forget on the renderer. React doesn't wait on them.
- Don't use `@pixi/react`. The reactive bridge isn't worth the perf cost on a 30-checker board with physics dice.

---

## Redux state management rules

- **`apps/game` and `apps/admin` are separate, independent Redux apps.** The rules below describe `apps/game`, which owns
  `apps/game/src/store/` (`store.ts`, `baseApi.ts`, `hooks.ts`). `apps/admin` is an independent application with its own
  Redux Toolkit store and single admin RTK Query API under `apps/admin/src/store/` — `store.ts` (`createAdminStore`),
  `baseApi.ts` (`adminBaseApi` on `fakeBaseQuery`), `hooks.ts` (`useAdminDispatch`/`useAdminSelector`). Admin features
  inject endpoints into `adminBaseApi` from `features/<X>/<x>Api.ts`. The two apps never share a store.
- **Redux Toolkit is the application-state framework; RTK Query is the only server cache.** `store/store.ts` configures
  the store strictly: default immutable + serializable checks stay enabled, no ignored paths, no broad exceptions.
  `store/baseApi.ts` is the single shared `createApi` with `fakeBaseQuery<ApiError>()`; features inject endpoints into
  it from `features/<feature>/` (never a second `createApi`).
- **Never copy RTK Query results into an ordinary slice.** Server data stays in the `api` reducer. Slices hold only
  serializable UI state (replay keeps only `ply` + `playing`). Query data, errors, boards, and totals are read via
  selectors.
- **Listener middleware owns workflows, features own the effects.** Async orchestration — timers, polling, Realtime
  subscriptions, delayed transitions, cross-feature reactions — lives in `features/<feature>/<feature>Listeners.ts` as
  cancellable listener effects, registered through `start<Feature>Listeners(startListening)`.
  `store/listenerMiddleware.ts` is a composition root that only calls those registrations. Components never own
  timers/polling; the workflow is cancelled by dispatching a matched control action.
- **A feature owns its whole vertical slice.** Slice, selectors, injected endpoints, Supabase reads/RPC wrappers and
  listeners all sit in `features/<feature>/`. Once a route is migrated its data access moves out of `lib/`; `lib/` keeps
  infrastructure (`supabase.ts`, auth, billing). The Redux migration is complete. See
  `.claude/skills/redux-integration/SKILL.md` for the current file-role authority.
- **Redux state must be serializable.** No `Set`, `Map`, class instances, Pixi objects, Realtime channels, promises,
  abort controllers, DOM elements, or values that can be reliably derived. Route params (`gameId`), totals, and boards
  are derived via memoized selectors (`createSelector`), never stored.
- **Mount one `<Provider>` at the root** (`main.tsx`, inside `StrictMode`, wrapping existing providers). Use the typed
  hooks from `store/hooks.ts` (`useAppDispatch`/`useAppSelector`); feature API hooks are exported from their feature
  module. No barrels.

---

## Tests

- `pnpm test` runs the Vitest suite once. `pnpm run test:watch` for TDD on engine work.
- **Packages are tested; apps are not.** `vitest.config.ts` is scoped to `packages/**`. What's covered is the pure
  deterministic logic: engine rules, AI decision logic, the economy sim, and board hit-area geometry. `fuzz.test.ts`
  guards the `legalMoves`/`applyMove` invariant that would otherwise surface as a mid-match desync in live PvP;
  `hit-areas.test.ts` guards click routing across every theme and aspect ratio (it carries a regression case for a
  shipped bug where a point centre resolved to the bear-off tray).
- The browser code inside `packages/` — the Pixi renderer, `ai/client.ts`, `ai/worker.ts` — is **not** tested, same as
  `apps/`. Test pure functions, not the things that draw or thread them.
- **Client code is deliberately not tested.** No tests for React components, Pixi/renderer, Redux slices/selectors,
  listener middleware, or RTK Query endpoints. These churned faster than they caught bugs. Do not add them back, and do
  not widen the Vitest glob to `apps/**`, without discussing it first.
- The split is mechanical, not a convention to remember: if logic deserves a test, it belongs in `packages/`, and the
  boundary checker guarantees `packages/` can never reach into `apps/`.
- `pnpm run sim` runs the Monte-Carlo economy + AI-ladder harness (`scripts/run-economy-sim.mjs` →
  `packages/sim/src/runSim.ts`) — `SIM_GAMES=4000 pnpm run sim` for a longer run.

---

## When pushed to do something that breaks the above

Say so directly. If a request would put rules logic in Pixi, validate moves on click, or roll dice client-side in online
play, push back and propose the correct layer. The user (Yaniv) prefers critical pushback over silent compliance.
