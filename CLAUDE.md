# Backgammon — Architecture & Working Notes

> Read this before making changes. Engine is pure TS and the source of truth — UI is a view of board state, not a place to put rules.

---

## Core design principle

**The engine is pure, deterministic, and serializable.** Given a `BoardState` and a dice roll, every legal move is generated up front by `legalMoves()`. The UI never validates moves on click; it asks the engine what's legal and offers those choices. This is what makes online play and AI possible without rewriting logic.

When adding a feature, ask: *does this belong in the engine (rules/state) or in the view (Pixi/React)?* Mixing them is the most common bug source.

---

## Phase roadmap — respect the order

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Pure TS rules engine, board UI in PixiJS, dice physics, hot-seat 2-player, single games | 🟢 Done |
| 2 | Match play, Crawford rule, doubling cube offer/accept/drop | 🟢 Engine + UI done — `packages/engine/src/match.ts` + 32 tests; `MatchHeader`, `CubeOfferDecision`, `EndOfGameModal` wired in hot-seat and online. **Defaults to target=1 (single-game quick matches)** — the N-point + Crawford + cube infrastructure stays in place but is unused until tournaments ship. |
| 3 | AI opponent (3 tiers), Web Worker eval | 🟡 Mostly done — AI plays online matches as a **fallback** when matchmaking can't find a human opponent. Pure PvP is the primary mode. |
| 4 | Supabase auth + guest sessions, profile, match history, replays, ELO/Glicko | 🟢 Auth + guests + profile done; replays shipped as the Redux Toolkit/RTK Query pilot; ELO TBD |
| 5 | Online multiplayer — server-authoritative dice, Realtime moves, private invites, reconnect | 🟢 Done |
| 6 | Public lobby, ELO matchmaking, spectator mode | 🟡 Matchmaking RPC wired; ELO + spectator TBD |
| 7 | Variants — Nackgammon, hyper-gammon, acey-deucey | ⬜ |

> **Direction update**: the app is primarily a real-time PvP backgammon game. AI matches are the fallback when matchmaking can't pair the player with a human. Phase ordering above reflects the original plan; current focus is on the live PvP experience, the lobby/shop/daily-bonus surface, and gameplay polish (image→CSS conversions).

---

## Non-negotiables

1. **The engine in `packages/engine/src/` is pure TypeScript.** No React, no Pixi, no Supabase. If you import any of those into engine code, you've made a mistake. Engine functions take `BoardState` in, return new `BoardState` out. Everything is immutable.
2. **Dice are server-authoritative in online play.** Phase 5 onward, clients NEVER roll their own dice. Edge Function generates the roll, writes it to the match record, broadcasts via Realtime. The seeded `Rng` in `dice.ts` is only for local play and tests.
3. **Pixi never holds game state.** `BoardRenderer` has an imperative `render(state)` API. It's a view function. If you find yourself storing turn/move/dice in Pixi code, stop.
4. **Stake/match-value framing, not bet/winnings.** Virtual chips only. No real-money chip purchases, no cash-out path. This keeps us out of "simulated gambling" regulatory territory.
5. **Application state lives in Redux Toolkit; server data lives in RTK Query.** The store (`apps/game/src/store/`) is the only place app state lives, and `baseApi.ts` is the one shared RTK Query API — features inject endpoints into it. No other state/server-cache library (TanStack Query, Zustand, …), no form library, no `@pixi/react`. Ask before adding new libraries.
6. **Doubling cube needs a confirm step.** Single-tap cube offers caused user complaints in the reference app (Lord of the Board). Long-press or two-tap.
7. **No client barrel files or re-exports.** Import each source module directly.

---

## File structure

```
apps/
├── game/src/                      → Player application
│   ├── game/                      → React-side session state
│   ├── board/                     → Player board data adapters
│   ├── store/                     → Redux store, typed hooks, listener middleware, shared RTK Query API
│   ├── features/                  → Per-feature slices, endpoints, selectors, Supabase data access, listeners (one dir per feature)
│   ├── components/
│   ├── pages/
│   ├── lib/
│   ├── App.tsx
│   └── main.tsx
└── admin/src/                     → Independent Back Office application
packages/
├── engine/src/                    → Pure TypeScript rules and tests
├── ai/src/                        → Pure AI decision logic (picker/evaluator/strength) + Worker bridge
├── sim/src/                       → Headless economy + AI-ladder simulator (`npm run sim`)
├── board-renderer/src/            → Shared Pixi renderer and geometry
├── board-preview/src/             → Back Office board preview
└── shared/src/                    → Shared database types and pure utilities
```

**`packages/` is shared logic; `apps/` is UI and client state.** Nothing under `packages/` may import from `apps/` — `scripts/check-app-boundaries.mjs` enforces it. `engine`, `ai` and `sim` are additionally *dependency-free*: engine + siblings only, no npm imports (the checker rejects bare specifiers there). That's what lets `build-shared-ai.mjs` mirror `packages/ai/src` verbatim into a Deno edge function for server-side bots. Two exceptions to headlessness live in `packages/`: `ai/client.ts` + `ai/worker.ts` (Web Worker bridge) and all of `board-renderer` (Pixi) — both are browser code, and neither is tested.

**New page checklist:**
- Imports engine through a relative path to the specific module in `packages/engine/src`
- Uses primitives from `components/UI.tsx` — no custom buttons
- Added to `App.tsx` routes

---

## Coordinate convention

- Points are indexed `0..23`.
- **White's home is `18..23`. Black's home is `0..5`.**
- **White moves low→high (idx +1). Black moves high→low (idx -1).**
- `bar` and `off` are separate slots on `BoardState`, not points.
- Bar entry: white enters at point `die - 1` (i.e. 0..5, black's home). Black enters at point `24 - die` (i.e. 18..23, white's home).
- Bear-off exit: white's "off" is past index 23 (target = from + die ≥ 24). Black's "off" is past index 0 (target = from - die ≤ -1).
- Pip count is anchored by `pipCount()`: distance for white = `24 - idx`, for black = `idx + 1`. Opening position pip count = 167 for both — that's the canonical sanity check.

If anything in the rules code seems backwards, run the engine tests first — they encode the convention authoritatively.

---

## Engine principles

- **Immutability**: `applyMove` returns a new `BoardState`. Never mutate.
- **Up-front legal moves**: `legalMoves(state, remainingDice)` returns every legal sequence the player could play. UI shows highlights based on this list.
- **Determinism**: Given (state, dice), there is one canonical board after applying a move. This is what makes replays and server validation work.
- **No exceptions for "obvious" cases**: Even if both dice are unusable, `legalMoves()` returns `[]` — UI handles the "skip turn" case.

---

## PixiJS integration rules

- One `<BoardCanvas>` component owns the Pixi `Application`. It mounts on a div ref.
- The renderer is an imperative class. React passes `BoardState` props; the canvas calls `renderer.render(state)` inside a `useEffect`.
- Animations (move, hit, dice roll, bear-off) are fire-and-forget on the renderer. React doesn't wait on them.
- Don't use `@pixi/react`. The reactive bridge isn't worth the perf cost on a 30-checker board with physics dice.

---

## Redux state management rules

- **Redux Toolkit is the application-state framework; RTK Query is the only server cache.** `store/store.ts` configures the store strictly: default immutable + serializable checks stay enabled, no ignored paths, no broad exceptions. `store/baseApi.ts` is the single shared `createApi` with `fakeBaseQuery<ApiError>()`; features inject endpoints into it from `features/<feature>/` (never a second `createApi`).
- **Never copy RTK Query results into an ordinary slice.** Server data stays in the `api` reducer. Slices hold only serializable UI state (replay keeps only `ply` + `playing`). Query data, errors, boards, and totals are read via selectors.
- **Listener middleware owns workflows, features own the effects.** Async orchestration — timers, polling, Realtime subscriptions, delayed transitions, cross-feature reactions — lives in `features/<feature>/<feature>Listeners.ts` as cancellable listener effects, registered through `start<Feature>Listeners(startListening)`. `store/listenerMiddleware.ts` is a composition root that only calls those registrations. Components never own timers/polling; the workflow is cancelled by dispatching a matched control action.
- **A feature owns its whole vertical slice.** Slice, selectors, injected endpoints, Supabase reads/RPC wrappers and listeners all sit in `features/<feature>/`. Once a route is migrated its data access moves out of `lib/`; `lib/` keeps infrastructure (`supabase.ts`, auth, billing) and the data layer of routes that are still unmigrated. See `reports/redux-migration.md` for the file-role table.
- **Redux state must be serializable.** No `Set`, `Map`, class instances, Pixi objects, Realtime channels, promises, abort controllers, DOM elements, or values that can be reliably derived. Route params (`gameId`), totals, and boards are derived via memoized selectors (`createSelector`), never stored.
- **Mount one `<Provider>` at the root** (`main.tsx`, inside `StrictMode`, wrapping existing providers). Use the typed hooks from `store/hooks.ts` (`useAppDispatch`/`useAppSelector`); feature API hooks are exported from their feature module. No barrels.

---

## Tests

- `npm test` runs the Vitest suite once. `npm run test:watch` for TDD on engine work.
- **Packages are tested; apps are not.** `vitest.config.ts` is scoped to `packages/**`. What's covered is the pure deterministic logic: engine rules, AI decision logic, the economy sim, and board hit-area geometry. `fuzz.test.ts` guards the `legalMoves`/`applyMove` invariant that would otherwise surface as a mid-match desync in live PvP; `hit-areas.test.ts` guards click routing across every theme and aspect ratio (it carries a regression case for a shipped bug where a point centre resolved to the bear-off tray).
- The browser code inside `packages/` — the Pixi renderer, `ai/client.ts`, `ai/worker.ts` — is **not** tested, same as `apps/`. Test pure functions, not the things that draw or thread them.
- **Client code is deliberately not tested.** No tests for React components, Pixi/renderer, Redux slices/selectors, listener middleware, or RTK Query endpoints. These churned faster than they caught bugs. Do not add them back, and do not widen the Vitest glob to `apps/**`, without discussing it first.
- The split is mechanical, not a convention to remember: if logic deserves a test, it belongs in `packages/`, and the boundary checker guarantees `packages/` can never reach into `apps/`.
- `npm run sim` runs the Monte-Carlo economy + AI-ladder harness (`scripts/run-economy-sim.mjs` → `packages/sim/src/runSim.ts`) — `SIM_GAMES=4000 npm run sim` for a longer run.

---

## When pushed to do something that breaks the above

Say so directly. If a request would put rules logic in Pixi, validate moves on click, or roll dice client-side in online play, push back and propose the correct layer. The user (Yaniv) prefers critical pushback over silent compliance.
