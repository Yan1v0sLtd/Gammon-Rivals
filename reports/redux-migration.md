# Player App Redux Toolkit Migration

## Goal

Migrate the player application incrementally to a strict Redux Toolkit architecture without changing game behavior, server authority, or the Pixi rendering boundary.

The target stack is:

- **Redux Toolkit slices** for serializable client and workflow state.
- **RTK Query** as the only client-side cache for Supabase server data.
- **Listener middleware** for cancellable workflows and reactions between domain events.
- **React Redux** selectors and dispatch for React integration.
- **The existing pure engine** for deterministic game rules and transitions.
- **Pixi** as a stateless board renderer receiving snapshots from React.

Zustand, MobX, and TanStack Query should not be introduced alongside this architecture. Running two client stores or two server caches would weaken ownership rules and make invalidation harder to reason about.

## Non-negotiable ownership rules

1. RTK Query results must not be copied into ordinary slices.
2. Slices contain only serializable client state. Keep Redux Toolkit's serializable and immutable checks enabled without broad exclusions.
3. Supabase clients, Realtime channels, timers, promises, DOM nodes, Pixi objects, `Set`, and `Map` do not belong in Redux state.
4. Reducers are pure and never call Supabase, navigate, start timers, or invoke AI.
5. Selectors own values that can be derived reliably from canonical state.
6. Listener middleware owns cancellable multi-step workflows. RTK Query endpoint lifecycles own subscriptions tied directly to query-cache lifetime.
7. Actions describe domain events such as `replayEntered` or `matchmakingCancelled`, not generic operations such as `setData`.
8. Route entry and exit are explicit events so temporary feature state is initialized and cleared predictably.
9. Supabase remains the authentication-token authority. Online dice and game outcomes remain server-authoritative.
10. The engine remains pure and independent of Redux, React, Supabase, and Pixi.
11. Use one shared RTK Query `createApi` instance and inject feature endpoints into it. Do not create one API instance per feature.
12. Each phase must preserve compatibility for routes that have not migrated yet.
13. A feature owns its whole vertical slice: slice, selectors, injected endpoints, Supabase data access, and listener workflows all live in `features/<feature>/`. `store/` holds only wiring shared by every feature.
14. `store/listenerMiddleware.ts` is a composition root. It creates the middleware, builds the typed `startListening`, and calls one `start<Feature>Listeners()` per feature. No listener effect, matcher, or timing constant is defined there.
15. Once a route is migrated, its Supabase reads and RPC wrappers move out of `lib/` into the owning feature. `lib/` keeps only cross-cutting infrastructure and the data layer of routes that have not migrated yet.

## Feature module layout

Each directory under `apps/game/src/features/<feature>/` uses the same file roles. No barrels, no re-export shims: consumers import the specific module.

| File | Role |
| --- | --- |
| `<feature>Slice.ts` | `createSlice` — serializable client state, domain-event action names, timing constants that describe presentation. |
| `<feature>Selectors.ts` | `createSelector` derivations, including anything read from the RTK Query cache. |
| `<feature>Api.ts` | `baseApi.injectEndpoints` — the only place endpoints, tags, and invalidation live. |
| `<feature>Data.ts` | Supabase reads, writes, and RPC wrappers the endpoints call. Plain async functions, no Redux imports. |
| `<feature>Listeners.ts` | `start<Feature>Listeners(startListening: AppStartListening)` — cancellable workflows, timers, polling. |
| `<feature>Actions.ts` | Cross-boundary events that no single slice reduces (for example `shopGrantConfirmed`). |
| `<feature>Errors.ts` | Error-to-message mapping used by the feature's workflows. |

Feature listener modules receive the `AppStartListening` type from `store/listenerTypes.ts`, never the middleware instance. That keeps imports one-way: the middleware imports features, features never import the middleware.

Cross-feature imports are allowed when one feature genuinely owns the reaction — `features/auth` reads `features/playerData` because auth owns sign-out and identity-scoped cache resets, while player data owns the profile row.

### Migration status

| Phase | State |
| --- | --- |
| 1 Foundation + Replay pilot | Done |
| 2 Auth and player-data boundary | Done |
| 3 Profile route | Done |
| 4 Application shell state | Done |
| 5 Shop | Done |
| 6 Lobby server data | Done |
| 7 Lobby workflows | Done |
| 8 Match-entry routes | Done |
| 9a Gameplay slice and selectors | Not started |
| 9b AI turn workflow | Not started |
| 9c Turn timer and auto-roll | Not started |
| 9d Match persistence | Not started |
| 9e Retire the compatibility hook | Not started |
| 10a Active-match cache entry | Not started |
| 10b Selectors and interaction slice | Not started |
| 10c Commands and optimistic selection | Not started |
| 10d Turn timers, presence, server pokes | Not started |
| 10e Retire the compatibility hook | Not started |
| 11–12 | Not started |

Current feature directories: `appUi`, `auth`, `lobby`, `playerData`, `replay`, `shop`.

### What deliberately stays in `lib/`

- `supabase.ts`, `auth.tsx`, `nativeAuth.ts`, `nativeGoogleAuth.ts`, `billing/` — infrastructure and platform bridges, not feature data.
- `persistence.ts` — `createMatch`, `saveGame`, `finishMatch`, `finishMatchRpc`, `updateMatchScore`, `deleteMyAccount`, and the `MatchMode` type. They serve the unmigrated `HotSeat`, `PlayOnline`, and `DeleteAccount` routes. The `HotSeat` share (`createMatch`, `saveGame`, `finishMatch`, `finishMatchRpc`, `modeFromAi`) plus the `MatchMode` type — still imported type-only by `features/lobby/matchmakingData.ts` — move to the gameplay feature in Phase 9d; the rest waits for Phase 10 and the `DeleteAccount` route.
- `identity.ts`, `aiPersona.ts` — consumed only by the unmigrated gameplay routes, plus the generic `avatarUrl` helper. Both are shared by `HotSeat` and `PlayOnline`, so they stay in `lib/` through Phase 9 and move in Phase 10.
- `useAutoRoll.ts`, `useMatchPresence.ts`, `useOnlinePresence.ts`, `useImagePreloader.ts`, `usePrefetchOnIdle.ts`, `warmImages.ts`, `bodyModalFlag.ts`, `format.ts`, `constants.ts`, `loadingScreenImage.ts` — presentation and browser-pipeline utilities that are not server state.

## Phase 1: Foundation and Replay pilot

### Scope

- Add and configure Redux Toolkit, React Redux, RTK Query, and typed app hooks.
- Create the shared store, base API, and listener middleware.
- Mount the Redux provider without removing existing providers.
- Migrate `/replay/:gameId`.
- Keep replay server data in an RTK Query endpoint.
- Keep only playback position and playback status in a replay slice.
- Reconstruct the displayed board through pure selectors.
- Dispatch explicit replay entry and exit actions.

### Reasoning

Replay is the lowest-risk route that still proves the complete architecture. It contains server data, client state, engine-based derivation, loading, errors, and route lifecycle, but it has no mutations, wallet impact, Realtime subscription, server-authoritative dice, or opponent race conditions.

Starting with infrastructure alone would not prove that the conventions work. Starting with auth, lobby, or gameplay would combine the infrastructure risk with a critical feature migration. Replay provides a useful vertical slice while keeping the impact small.

The first endpoint may wrap the existing `getGameWithMoves()` function. Reusing the repository call avoids changing the data-access implementation and state architecture simultaneously.

### Completion gate

- Redux DevTools shows clear replay lifecycle and playback actions.
- The replay query is deduplicated under React StrictMode.
- Route exit resets replay client state but does not manually copy or clear cached query data.
- Board reconstruction is selector-driven and covered by tests.
- No serializability or immutability warnings are disabled.
- Every other route behaves as before.

## Phase 2: Authentication and player data boundary

### Scope

- Keep Supabase responsible for token storage, refresh, OAuth, anonymous sessions, and native sign-in.
- Represent the serializable authentication view in Redux: initialization status, user identity, and sign-in state.
- Move profile, wallet, level configuration, level-status tiers, and active XP boost reads into RTK Query.
- Convert existing `refreshProfile`, `refreshWallet`, and `refreshXpBoost` behavior into RTK Query invalidation or refetching.
- Preserve `useAuth()` temporarily as a compatibility facade for routes that have not migrated.
- Reset user-specific RTK Query cache on sign-out or account change.

### Reasoning

Profile and wallet data are consumed by Profile, Shop, Lobby, HotSeat, and PlayOnline. Their cache keys and invalidation rules must exist before those routes migrate. Otherwise, every route will invent its own player-data handling and later require another rewrite.

Authentication tokens are not ordinary application state. Supabase must remain their authority. Redux should expose a serializable view of authentication, while RTK Query owns server rows associated with the current user.

Clearing user-specific cache on identity changes is critical. Without it, a guest or newly signed-in player could briefly see the previous account's wallet or profile.

### Completion gate

- One auth-state subscription exists for the player app.
- Profile and wallet requests are deduplicated across consumers.
- Sign-out clears user-specific cached data.
- Existing routes can continue using the compatibility `useAuth()` API.
- No component stores a second copy of profile or wallet data.

## Phase 3: Profile route

### Scope

- Migrate profile, owner statistics, and match-history reads to RTK Query.
- Add mutations for display-name updates and relevant account actions.
- Update or invalidate the correct profile and history tags after mutations.
- Keep form drafts, edit mode, confirmation text, button feedback, and temporary errors local unless multiple branches genuinely need them.

### Reasoning

Profile is the safest mutation-heavy route. It establishes strict mutation, pending-state, error, cache-update, and tag-invalidation conventions before money-like wallet operations and matchmaking are touched.

It also validates the authentication boundary from Phase 2. If profile identity changes are not reflected consistently, that problem should be fixed before Shop and Lobby depend on the same cache.

Not every state value belongs in Redux. Keeping short-lived form state local prevents the global store from becoming a mirror of the component tree.

### Completion gate

- Profile and history data have one RTK Query owner.
- Display-name mutation updates every consumer consistently.
- The page no longer performs direct Supabase reads.
- Form behavior remains local and unchanged.

## Phase 4: Application shell state

### Scope

- Add a small `appUi` slice.
- Migrate app-wide shop visibility and navigation-overlay phase.
- Preserve lazy loading of the Shop bundle and loading-screen behavior.
- Replace state-owning contexts with compatibility hooks over Redux until all consumers migrate.
- Define explicit actions for opening, closing, showing, fading, and completing transitions.

### Reasoning

Shop visibility and the route-spanning navigation overlay are true application-level client state. They outlive individual route components and are consumed from unrelated parts of the tree.

Migrating them after the Profile pilot proves ordinary slices and mutations before changing root-level UI behavior. This phase also establishes how global client state differs from feature-local and component-local state.

The goal is not to move every modal into `appUi`. Feature-specific modals should remain in their feature slice or component.

### Completion gate

- Shop and navigation state have one Redux owner.
- Route changes do not leave the overlay or shop stuck open.
- Lazy loading and body modal flags behave as before.
- No route-specific state is added to `appUi`.

## Phase 5: Shop

### Scope

- Replace the manual module-level `shopCache.ts` cache with RTK Query.
- Add endpoints for the catalog, current sale, and store configuration.
- Use RTK Query prefetching to preserve instant first-open behavior.
- Add purchase mutations.
- Invalidate or update wallet, XP boost, and inventory tags according to the granted item.
- Keep toast state, reward-flight animation data, scaling, and pressed-button state local to the Shop UI.
- Keep browser image warming separate from server-data caching.

### Reasoning

The current Shop cache manually implements request deduplication, prefetching, background refresh, and cache updates. RTK Query directly replaces this infrastructure and provides a strong test of cross-feature invalidation.

Shop comes before Lobby because Lobby opens the Shop and shows the same wallet. Wallet invalidation must be reliable before the larger Lobby migration starts.

Image decoding and browser cache warming are presentation concerns. RTK Query should cache catalog data, not attempt to replace the browser image pipeline.

### Completion gate

- Opening Shop performs no duplicate catalog request when prefetched.
- Purchases update all relevant player-data consumers.
- The manual data cache is no longer needed.
- Animation and toast behavior remain independent of Redux server state.

## Phase 6: Lobby server data

### Scope

Migrate the existing server-backed lobby hooks one at a time while preserving their public interfaces where useful:

- Board configurations.
- User board inventory.
- Lobby feature configuration.
- Daily bonus configuration and player state.
- Wheel state.
- Daily missions.
- Lobby profile statistics.
- Difficulty and table configuration.

Replace manual fetch effects, cancellation booleans, in-flight refs, and refresh counters with RTK Query queries and mutations.

Use RTK Query cache lifecycles such as `onCacheEntryAdded` for Realtime subscriptions whose lifetime exactly matches a query subscription. Realtime events should patch or invalidate the appropriate cache entry rather than call component-private fetch functions.

### Reasoning

`LobbyScreen` is large partly because it coordinates several custom server-state hooks. Migrating the screen before these hooks would mix server caching, UI workflow, and layout changes in one high-risk step.

Migrating each data source independently creates stable endpoints and tags first. It also exposes incorrect cache boundaries early, especially for user-specific inventory, missions, and wallet changes.

RTK Query cache lifecycle is preferable for a stream that exists only while cached data has active subscribers. Listener middleware remains appropriate for workflows spanning several slices, endpoints, or routes.

### Completion gate

- Lobby server rows exist only in RTK Query cache.
- Existing manual refresh counters are removed from migrated hooks.
- Realtime subscriptions start and stop with their data consumers.
- Daily bonus, wheel, mission, and board mutations invalidate the intended tags.
- The visible Lobby behavior is unchanged.

## Phase 7: Lobby workflows

### Scope

- Add a lobby slice for route-level client workflows.
- Represent the active full-screen modal as one discriminated state rather than many independent booleans.
- Move selected-board workflow, board-purchase workflow, daily reward coordination, and matchmaking presentation into explicit events where they cross component boundaries.
- Move cancellable matchmaking polling and timeout behavior into listener middleware.
- Keep purely visual animation state local where practical.
- Dispatch explicit lobby entry and exit actions.

### Reasoning

Once RTK Query owns Lobby server data, the remaining complexity is client workflow. Separating these steps prevents server rows from being copied into the lobby slice.

A discriminated modal state prevents impossible combinations such as several full-screen Lobby modals being open simultaneously. Explicit matchmaking events make cancellation, timeout, success, AI fallback, and route exit observable in Redux DevTools.

Listener middleware is suitable for matchmaking because it supports cancellation and reacting to route-exit events without storing timer handles or promises in Redux.

### Completion gate

- Only one full-screen Lobby modal can be active.
- Leaving the route cancels matchmaking and clears temporary Lobby state.
- Matchmaking actions form a readable event sequence.
- Lobby server data remains in RTK Query, not the lobby slice.

## Phase 8: Match-entry routes

### Scope

Phase 8 was planned as a migration of invite joining, public-match joining, room entry, and related queue workflows. Investigation before implementation established there was nothing live left to migrate, so the phase was executed as a deletion phase plus one documented contract:

- Deleted the `/lobby` route and `pages/Lobby.tsx`. The page was an orphan — its `<Route>` registration in `App.tsx` was the only reference — and the sole consumer of a legacy parallel matchmaking implementation (the old `matchmake` RPC, a component-owned Supabase Realtime channel on `matchmaking_queue`, and a 30-second `setInterval`) that duplicated the tier matchmaking already shipped in Phase 7.
- Deleted the `/join/:code` route, `pages/JoinMatch.tsx`, and the invite-link card on `pages/PlayOnline.tsx`. The route was non-functional: no SQL function writes `matches.invite_code`. `find_match_in_tier`, `matchmake`, and `enter_room_ai_fallback` all leave it NULL, and `supabase/migrations/20260529000000_enter_room.sql:55` carries a comment explicitly deferring it. The only writer was `createOnlineMatch()` in `lib/persistence.ts`, callable only from the deleted `/lobby` page, so no invite URL was ever produced and no code could be joined.
- Pruned `lib/persistence.ts`: `createOnlineMatch`, `joinMatchByInvite`, `joinPublicMatch`, `matchmake`, `cancelMatchmaking` (a duplicate client wrapper — the live cancel path is `cancelMatchmakingRpc` in `features/lobby/matchmakingData.ts`), `listPublicMatches`, and three exports that already had zero consumers repo-wide (`getMatchById`, `cancelMatch`, `MatchRowWithoutInternals`).
- Kept the server side intact. `join_match_by_invite`, `join_public_match`, `matchmake`, `cancel_matchmaking`, and the `matches.invite_code` / `matches.is_public` columns all remain, so a future designed invite / public-lobby / spectator feature starts from working server primitives.
- Added `apps/game/src/game/matchEntryPath.ts`, a pure builder exporting `MatchEntry` and `matchEntryPath(entry)` — the single definition of the lobby→gameplay handoff payload (query params `opp`, `target`, `board`, `matchId`, `turn`; `mode` `'pvp'`/`'online'` routes to `/play/:matchId`, legacy AI levels to `/hotseat`). `useLobbyMatchmaking.ts` is its only caller today; `PlayOnline` and `HotSeat` parse those params and will be unified against this module in Phases 9–10. No `features/matchEntry/` directory was created: after the deletions this phase owns no server data and no client state, so a feature directory would have been an empty shell.

### Reasoning

Room entry and queue workflows were already migrated in Phase 7. `features/lobby/matchmakingListeners.ts` owns the whole workflow — poll `find_match_in_tier`, then `enter_room_ai_fallback` on timeout, cancelling on route exit — and `lobby/useLobbyMatchmaking.ts` navigates only after a confirmed server result, with duplicate-submit protection via the `selectEnteringRoomId` selector. What remained outside the architecture was not live functionality but two unreachable pages: `/lobby`, which duplicated the shipped tier matchmaking with a legacy implementation, and `/join/:code`, which could never function because no server RPC mints an invite code.

Migrating routes users cannot reach would have manufactured migration work without a consumer. The phase instead deleted the dead surfaces and captured the entry-payload contract that Phases 9–10 will standardize against, while deliberately leaving the server RPCs and columns in place so the future invite / public-lobby / spectator feature builds on working primitives.

**Follow-up finding:** `matches.invite_code` is written by no server RPC. Any future invite feature must mint an invite code server-side before a `/join/:code` route can be reintroduced.

### Completion gate

- `/lobby` and `/join/:code` no longer route anywhere; nothing in the repo links to the deleted pages.
- `lib/persistence.ts` serves only the unmigrated `HotSeat`, `PlayOnline`, and `DeleteAccount` routes.
- The lobby→gameplay handoff payload has one documented definition in `apps/game/src/game/matchEntryPath.ts`.
- Room-entry workflows, duplicate-submit protection, and navigation-after-confirmed-result remain in `features/lobby/matchmakingListeners.ts` and `lobby/useLobbyMatchmaking.ts`.
- Server RPCs and columns for invite, public lobby, and spectator remain untouched.

## Phase 9: Local gameplay

### Scope

- Migrate `useGame` behind a gameplay slice while preserving its external API during transition.
- Store canonical, serializable local-session state: match, board, roll, remaining dice, move history, undo snapshot, and turn records.
- Derive legal origins, valid destinations, action availability, and display status through selectors.
- Model player actions as explicit gameplay events.
- Move cancellable AI and turn-timer workflows into listener middleware.
- Keep the engine unchanged during the state migration.
- Keep Pixi stateless and driven by `BoardState` and selection props.

Out of scope for the whole phase: online gameplay (Phase 10), any engine change (Phase 11), and the `PlayOnline` / `DeleteAccount` share of `lib/persistence.ts`.

### Reasoning

Local gameplay is the safest place to prove Redux for a full game session because it has no Realtime reconciliation or server-authoritative dice. By this phase, action, selector, listener, lifecycle, and RTK Query mutation conventions have already been exercised elsewhere.

Keeping the existing engine fixed provides a trusted behavior oracle while the controller changes. Refactoring the engine and its consumer together would make regressions harder to detect.

Derived legal state should not be duplicated in the slice. The pure engine and memoized selectors can calculate it from the canonical snapshot.

### Why this phase is split

Local gameplay is one hook and one page, but they are the two largest client files in the app: `game/useGame.ts` (592 lines — 12 `useState`, five derivation memos, 16 callbacks, and one 110-line async AI effect) and its only consumer `pages/HotSeat.tsx` (720 lines, which additionally owns match persistence, the turn timer, and auto-roll). Migrating them in one step means rewriting engine-state ownership, async AI orchestration, timers, and Supabase writes together, with no intermediate state that is deployable or reviewable. Phase 9 is therefore delivered as five sub-phases, 9a–9e.

The order is fixed by one dependency: every other owner reacts to gameplay domain events, so the slice that emits them lands first. Two constraints hold across all five sub-phases:

- **`useGame`'s return shape (`MatchGameState & MatchGameActions`) is the compatibility boundary.** `HotSeat` reads nearly every field of it, so the hook keeps that exact interface until 9e. Each sub-phase then changes one owner instead of the page.
- **Non-determinism enters through action payloads.** `roll()`, the opening-player coin flip in `randomFirstBoard()`, and `Date.now()` turn timestamps are produced by the dispatching layer (prepare callbacks) so reducers stay pure.

### Phase 9a: Gameplay slice and selectors

#### Scope

- Add `features/gameplay/gameplaySlice.ts` owning the canonical serializable session: `match`, `board`, `roll`, `remaining`, `selectedFrom`, `history`, `turnLog`, the single-step `undoSnapshot`, `lastGameResult`, and the `AIConfig`.
- Move the synchronous transitions into reducers that call the pure engine — roll, select origin, select destination, undo, end turn, forfeit, cube offer/accept/drop, next game, new match — named as domain events (`diceRolled`, `checkerMoved`, `turnEnded`, `gameFinished`).
- Add `gameplaySelectors.ts` for everything the hook memoizes today: legal moves, legal origins, valid destinations, opponent-preview origins and destinations, `canEndTurn`, `canOfferDouble`, `canUndo`, `matchOver`, `inCrawfordGame`, `isAITurn`. Set-based derivations return arrays, with a stable empty array.
- Reduce `useGame` to an adapter over `useAppSelector` / `useAppDispatch` behind its unchanged return shape. The AI effect stays in the hook for now and reads the slice.
- Dispatch explicit route entry and exit so a second visit to `/hotseat` starts from a clean session.

#### Reasoning

The slice must exist before anything can react to gameplay events, and it is the only sub-phase that can be verified purely by playing a local game: no async behavior changes here.

The undo snapshot looks derivable from `history` but is kept as stored state, because deriving it means replaying the turn through the engine — a behavior change that belongs to Phase 11, not to a state migration. `turnLog` timing is the opposite case: `startedAt` is a payload value, never a reducer-side clock read.

#### Completion gate

- Redux DevTools shows one readable event per player action.
- Serializable and immutable checks stay enabled with no ignored paths; no `Set`, `Map`, or clock read inside a reducer.
- Highlights, undo availability, and cube availability are unchanged in play.
- `HotSeat.tsx` is untouched.

### Phase 9b: AI turn workflow

#### Scope

- Move the AI orchestration effect (`useGame.ts:445-554`) and `playAISequence` (`:400-442`) into `features/gameplay/gameplayListeners.ts`, triggered by the slice events that hand the turn to the AI.
- Replace `aiActiveRef`, `stateRef`, and the local `sleep()` with `cancelActiveListeners()`, `delay()`, and `getState()`. Swallow `TaskAbortError`.
- Keep the AI timing constants (`AI_ROLL_DELAY`, `AI_PER_MOVE_DELAY`, `AI_END_TURN_DELAY`, `AI_CUBE_DECISION_DELAY`, dice-settle) exported from the slice together with their choreography comments.
- Keep `isAIThinking` and `aiPreviewReady` as slice flags, dispatched by the listener.
- `pickMoveAsync` remains the AI entry point; `packages/ai` and its worker are not touched.
- Preserve the recovery path: a planner or apply failure ends only the AI's turn, and only while it is still the AI's turn with no winner, instead of freezing the match.

#### Reasoning

This is the riskiest sub-phase, so it ships alone. The guard refs exist only because a React effect can re-enter and cannot cancel; listener middleware provides cancellation as a primitive, which also fixes a real gap — today leaving the route mid-AI-turn cannot stop the sequence.

#### Completion gate

- Leaving `/hotseat` during an AI turn cancels the sequence; no state update happens after unmount.
- A cube offer against the AI is still auto-accepted after its delay.
- A planner failure never leaves the match frozen on "AI thinking".
- No timer handle or promise enters Redux.

### Phase 9c: Turn timer and auto-roll

#### Scope

- Move the forfeit-on-timeout workflow out of `HotSeat.tsx:468-517` into the gameplay listener: store the turn deadline as epoch ms from the action payload, `delay()` until it, then dispatch the forfeit. The `timeoutHandledRef` guard becomes listener cancellation.
- Keep the countdown's 220 ms display tick local to the component that renders it, reading the deadline through a selector. It is presentation, not workflow.
- Move `lib/useAutoRoll.ts`'s effect into the same workflow, still gated on the reveal flag so dice do not roll behind the loading screen. The stored preference itself stays where it is.
- Fold route exit, game end, cube decision, and match over into the same listener so one place both starts and supersedes the countdown.

#### Reasoning

The timer is the last component-owned async loop in local play, and it mutates game state (`forfeitTurn`), so it belongs with the AI workflow that already owns turn transitions. Splitting deadline from display keeps the workflow cancellable without pushing a value into Redux every 220 ms.

#### Completion gate

- An expired turn forfeits exactly once; turn change, new game, and cube resolution restart the deadline.
- The countdown pauses while a modal blocks play, and stops on route exit.
- Auto-roll fires only after the reveal, once per turn.
- `HotSeat.tsx` owns no timer other than the countdown display tick.

### Phase 9d: Match persistence

#### Scope

- Move `createMatch`, `saveGame`, `finishMatch`, `finishMatchRpc`, `modeFromAi`, and the `MatchMode` type from `lib/persistence.ts` into `features/gameplay/gameplayData.ts`, wrap them as mutations in `gameplayApi.ts`, and update the type-only import in `features/lobby/matchmakingData.ts`.
- Replace HotSeat's three persistence effects (`:245-350`) with listener reactions to the gameplay events; the `persistedGameNumberRef`, `persistedMatchOverRef`, and `matchCreatedForUserRef` idempotence guards move into the workflow.
- Keep the `presetMatchId` branch: a match created by `enter_room` skips `createMatch` and finishes through `finishMatchRpc`; other matches keep the plain update.
- Replace the manual `refreshWallet()` / `refreshProfile()` calls after a rewarded finish with player-data tag invalidation.
- Keep the match id in the slice — it is an identifier, not a server row. The reward payload is read from the mutation result, never copied into the slice.

#### Reasoning

Persistence is deliberately last of the behavioral steps: it reacts to `gameFinished` and match completion, so doing it before 9a would mean wiring it to component effects and then rewiring it. It is also the step that lets `HotSeat` stop importing Supabase at all.

#### Completion gate

- Exactly one `createMatch` per session, one `saveGame` per completed game, and one finish call per match, including under StrictMode double-mount.
- Wallet and profile refresh through invalidation only.
- `lib/persistence.ts` retains only what `PlayOnline` and `DeleteAccount` still use.
- No Supabase call remains in `HotSeat.tsx`.

### Phase 9e: Retire the compatibility hook

#### Scope

- Delete `game/useGame.ts`; `HotSeat.tsx` reads selectors and dispatches events directly.
- Delete the types that existed only for the facade (`MatchGameState`, `MatchGameActions`, `UseGameOptions`).
- Leave `lib/identity.ts` and `lib/aiPersona.ts` in `lib/` — `PlayOnline` still consumes them, so they move in Phase 10.
- `HotSeat`'s remaining `useState` is presentation only: identities, theme, layout, loading gate, modals, alignment tool.

#### Reasoning

The facade is what made 9a–9d individually deployable; keeping it afterwards would leave two ways to read the same state. Removing it separately keeps the large `HotSeat` diff free of behavior changes.

#### Completion gate

- `useGame` and its types are gone and nothing imports them.
- `HotSeat.tsx` contains no engine transition and no gameplay rule.
- Behavior parity: legal moves, outcomes, rewards, timers, and auto-roll unchanged.

### Phase 9 completion gate

Reached when 9a–9e are all done:

- Existing local-game and engine tests remain green.
- Route exit cancels AI and timers.
- Redux state remains serializable.
- Legal moves and outcomes are unchanged.
- Pixi still owns no gameplay state.

## Phase 10: Online gameplay

### Scope

- Replace the monolithic responsibilities in `useOnlineGame` with an aggregate RTK Query snapshot, mutations, cache lifecycle, selectors, a small online-interaction slice, and listener workflows.
- Keep match, current game, moves, and current turn in one coherent active-match cache entry.
- Attach Realtime and fallback polling to the active cache entry.
- Implement optimistic checker selection/move updates through RTK Query cache patches where safe, with rollback or authoritative refetch on failure.
- Keep command guards for roll, end-turn, cube, resign, and inactivity operations.
- Keep server-authoritative dice and outcome validation unchanged.
- Preserve a compatibility hook while React components migrate.

Out of scope for the whole phase: any engine change (Phase 11), any edge-function or SQL change, spectator mode and the invite / public-lobby surfaces whose server primitives Phase 8 deliberately left in place, and the `DeleteAccount` share of `lib/persistence.ts`.

### Reasoning

Online gameplay is last because it combines every difficult state problem in the application:

- Server authority.
- Realtime updates.
- Polling fallback.
- Optimistic updates.
- Presence.
- Timers.
- Duplicate command prevention.
- Snapshot reconstruction.
- Route cleanup.

The current implementation deliberately updates match, moves, and current game together to avoid rendering mixed versions. RTK Query must preserve that invariant through one aggregate cache entry rather than independent queries.

By this phase, RTK Query subscriptions, listener cancellation, mutation invalidation, route lifecycle, and full local gameplay have already been validated independently.

### Why this phase is split

`game/useOnlineGame.ts` is 1299 lines — the largest client file in the app. It holds nine `useState`, eight `useRef` guards, twelve derivation memos, ten async server commands, and seven effects: the Realtime + fallback-poll subscription, the server-bot poke, the opponent dice-reveal delay, a one-second activity tick, the opponent-activity clock, the auto-forfeit chain, and the soft turn-timer auto-action. It is simultaneously the server cache, the derivation layer, the command layer, the presence listener, two independent clocks, the duplicate-command guard, and the match finaliser. Its only consumer, `pages/PlayOnline.tsx` (526 lines), reads roughly thirty fields off the returned object. Migrating it in one step means rewriting cache ownership, derivation, every server command, and four async workflows together, with no intermediate state that is deployable or reviewable. Phase 10 is therefore delivered as five sub-phases, 10a–10e.

The new code lives in `features/onlineMatch/`, separate from Phase 9's `features/gameplay/`: the online session's canonical state is server rows in the RTK Query cache, not a local slice, so the two features share no owner. Three constraints hold across all five sub-phases:

- **`useOnlineGame`'s return shape (`OnlineGameState & OnlineGameActions`) is the compatibility boundary.** `PlayOnline` reads nearly every field of it, so the hook keeps that exact interface until 10e. Each sub-phase then changes one owner instead of the page.
- **Server authority is not renegotiated.** Dice stay in `roll_dice`, turn commit in `finish_turn`, finalisation in `finish_match`, bot moves in `ai_move`. No sub-phase moves a rule from the server to the client, and no sub-phase changes an edge function.
- **The single-snapshot invariant survives the move.** `useOnlineGame.ts:276-310` batches match, moves, and game into one React update on purpose; a render with the new match and the old moves derives `initialBoard()` and re-animates the whole checker distribution. That invariant becomes one aggregate cache entry, never three queries.

### Phase 10a: Active-match cache entry

#### Scope

- Add `features/onlineMatch/onlineMatchData.ts` holding the reads from `refresh()` (`useOnlineGame.ts:257-318`), and `onlineMatchApi.ts` with one `getActiveMatch(matchId)` query whose result is the `{ match, moves, currentGame }` triple in a single cache entry.
- Attach the per-match Realtime channel and the `FALLBACK_POLL_MS` poll (`:331-375`) to that entry's `onCacheEntryAdded`. Keep the client-side `game_id` filter on `moves` INSERTs — without it every insert in the database wakes every client. `currentGameIdRef` becomes a read of the cache entry.
- Drop `fetchInFlight` in favour of RTK Query request deduplication, and keep an internal `refresh()` wrapper over refetch so the existing action callbacks stay untouched.
- `useOnlineGame` keeps its memos, actions, refs, and return shape. Only its data source changes.

#### Reasoning

Every command invalidates this entry and every workflow in 10d reads from it, so it lands first. Realtime belongs on the cache lifecycle rather than a listener because its lifetime is exactly the lifetime of an active subscriber to this one entry (ownership rule 6). The aggregate shape is a correctness requirement, not tidiness: independent match / moves / game queries would render mixed snapshot versions, which is the bug documented at `:276-286`.

#### Completion gate

- Match, moves, and current game always render from one snapshot; no board re-animation between a turn commit and the next moves fetch.
- One Realtime channel and one poll per mounted match, both released on unmount, with no StrictMode double-subscription.
- No duplicate concurrent fetch for the same match.
- `PlayOnline.tsx` is untouched.

### Phase 10b: Selectors and the interaction slice

#### Scope

- Move derivation into `onlineMatchSelectors.ts`, reading the 10a cache entry: `deriveState` (`:103-146`), the `current_turn` shape validation (`:388-402`), `localColor`, `effectiveTurn`, `betweenGames`, `gameWinner`, the cube fields, `roll`, `remaining`, local and opponent legal moves, `legalOrigins`, `validDestinations`, opponent-preview origins and destinations, `canRoll`, `canEndTurn`, `canOfferDouble`, `inCrawfordGame`. Set-based derivations return arrays with a stable empty array, as in 9a.
- Add `onlineMatchSlice.ts` for the only two values that are neither server rows nor derivable: `selectedFrom` and the opponent dice-reveal key (`:220`, `:503-522`). Dispatch explicit route entry and exit so a second visit to `/play/:matchId` starts clean.
- Preserve both defensive paths: a metadata-only `current_turn` (what `replace_opponent_with_ai` leaves behind) still reads as "no turn in progress", and a poisoned moves row still degrades to a logged board reset instead of a thrown render.
- Reduce `useOnlineGame` to an adapter over `useAppSelector` / `useAppDispatch` behind its unchanged return shape. Actions are untouched.

#### Reasoning

Derivation is pure and already memoised, so this sub-phase is verifiable by playing one game. Landing it before the commands means 10c dispatches against a state shape that will not move again.

Reference stability of `roll` (`:481-498`) is a behaviour contract of the selector, not an optimisation: `DiceTray` uses the array as a memo dependency, and a fresh reference restarts the throw animation every paint — the "dice spin forever" bug.

#### Completion gate

- Highlights, opponent-preview timing, cube availability, and the roll / end-turn affordances are unchanged in play.
- Dice do not re-spin on unrelated cache updates.
- No `Set`, `Map`, or clock read in a reducer; serializable and immutable checks stay enabled with no ignored paths.
- `PlayOnline.tsx` still consumes the hook only.

### Phase 10c: Commands and optimistic selection

#### Scope

- Convert `rollDice`, `endTurn`, `offerDouble`, `acceptDouble`, `dropDouble`, `selectTo`, `resign`, `claimByInactivity`, and `finalizeMatch` (`:598-899`, `:1030-1083`, `:1243-1255`) into `onlineMatchApi` mutations over `onlineMatchData` wrappers.
- Implement `selectTo` as an optimistic `updateQueryData` patch of `current_turn` on the aggregate entry, with rollback on failure and an authoritative refetch after. The `selectInFlightRef` / `pendingRefreshRef` refresh deferral (`:252-267`, `:714-735`) is replaced by the patch lifecycle.
- Move edge-function error decoding and the benign-race allowlist (`turn already in progress`, `no_turn_in_progress`, `not_your_turn`, `match_already_finished`, `opponent_still_active`, `race_lost`) into `onlineMatchErrors.ts`, shared by the roll and turn-commit paths.
- Keep duplicate-command protection: `rollInFlightRef` and `endTurnInFlightRef` become pending-mutation guards read through a selector, so a double click — or an auto-action racing a manual click — still produces one server write.
- Keep `endTurn` free of a `canEndTurn` check. `canEndTurn` is a UI affordance, not a correctness invariant; the timer path force-ends turns with legal moves remaining on purpose.
- Replace the manual wallet and profile refreshes after a rewarded finish with player-data tag invalidation.

#### Reasoning

The workflows in 10d do nothing but call these commands on a timer, so the commands must exist first; wiring the workflows to the old callbacks would mean rewiring them immediately after. The optimistic patch is the one place in this phase that can regress correctness invisibly, which is why it ships in the same sub-phase as the in-flight guards that protect it.

`dropDouble`'s client-side score arithmetic (`:852-899`) is carried over as-is. Moving it behind a server RPC is a server-authority change, not a state migration, and belongs to separate work.

#### Completion gate

- One server write per command under a double click and under an auto-action racing a manual one.
- A failed `selectTo` rolls back to the server view, and the fallback poll never clobbers a pending optimistic patch.
- Benign server races still refetch silently with no error surfaced.
- No client-generated dice and no client-computed outcome is introduced.
- Rewards refresh through invalidation only.

### Phase 10d: Turn timers, presence, and server pokes

#### Scope

Move all four async workflows into `features/onlineMatch/onlineMatchListeners.ts`:

- The soft per-turn auto-action (`:1181-1240`): auto-roll when `canRoll`, otherwise force-end the turn. The `autoActionFiredKeyRef` latch keyed on `(match, game, moves length, dice)` becomes listener cancellation, keeping the invariant of one auto-action per turn even after a manual submove lands.
- Presence and the inactivity claim: `lib/useMatchPresence.ts` moves into the feature and its channel joins the 10a cache lifecycle. `opponentDisconnectedAt` is stored as epoch ms in the slice, with the `PRESENCE_FORFEIT_GRACE_MS` grace period unchanged.
- The auto-forfeit chain (`:1105-1179`): `replace_opponent_with_ai` then `finish_match`, keeping the release-the-latch-and-retry behaviour for `opponent_still_active` and `race_lost` and the fall-through for the terminal reasons.
- The server-bot poke (`:443-474`): invoke `ai_move` when it is the bot's turn with no turn in progress, at most once per distinct board state so a failing invoke cannot spin.

Replace the one-second `now` tick (`:925-929`) with a deadline model: `lastLocalActivityMs`, `lastOpponentActivityMs`, and `opponentDisconnectedAt` are epoch ms in the slice, the listener `delay()`s to the deadline, and the visible countdown keeps its display tick in the component that renders it, reading the deadline through a selector — the same split as 9c.

Keep the two clocks distinct and keep their mount-time floor. Local activity drives the soft turn timer and is bumped by `selectFrom` even though it writes nothing; opponent activity is the `opponentSignature` (`:945-959`), never `match.updated_at`, because our own automated actions bump `updated_at` and would reset the claim clock forever.

#### Reasoning

This is the riskiest sub-phase — four independent reactions to one cache entry, three of which write to the server — so it ships alone and last of the behavioural steps. The ref latches exist only because a React effect can re-enter and cannot cancel; listener cancellation replaces all four and closes a real gap, since today leaving the route mid-forfeit or mid-poke cannot stop the sequence.

The deadline-versus-tick split matters for cost as well as purity: dispatching a timestamp once per second would re-run every selector in the page for the sake of one countdown label.

#### Completion gate

- An expired turn auto-rolls or force-ends exactly once per `(game, dice)` tuple, including after a manual submove.
- Opponent tab-close still forfeits after the grace period; the presence-based and time-based paths both behave as they do today.
- Auto-forfeit releases its latch on the retryable server reasons and holds it on the terminal ones.
- A bot turn is poked once per board state, and a failed `ai_move` does not loop.
- Route exit cancels every workflow. No timer handle, channel, or promise enters Redux, and nothing dispatches once per second.

### Phase 10e: Retire the compatibility hook

#### Scope

- Delete `game/useOnlineGame.ts` and the facade-only types (`OnlineGameState`, `OnlineGameActions`, `UseOnlineGameOptions`); `PlayOnline.tsx` reads selectors and dispatches events directly.
- Move the entry-parameter parsing — `?turn=` and the derived `inactivityForfeitMs` (`PlayOnline.tsx:54-82`) — next to `game/matchEntryPath.ts`, so the lobby→gameplay payload has one definition on both the producing and consuming side, as Phase 8 planned.
- Replace the last route-level Supabase write, the waiting-room "Cancel match" update (`PlayOnline.tsx:200-206`), with a feature mutation.
- Move `lib/aiPersona.ts` and the AI-identity helpers of `lib/identity.ts` (`aiIdentityFromSeed`, `aiRankLabel`) out of `lib/` now that both of their consumers are migrated. The generic `PlayerIdentity` type and `avatarUrl` stay in `lib/`: `Avatar`, `BoardLayout`, and `SidePanel` use them and are not feature code.
- `PlayOnline`'s remaining local state is presentation only: intro banner, theme, auto-roll toggle.

#### Reasoning

The facade is what made 10a–10d individually deployable; keeping it afterwards would leave two ways to read the same state. Removing it separately keeps the large `PlayOnline` diff free of behaviour changes.

#### Completion gate

- `useOnlineGame` and its types are gone and nothing imports them.
- `PlayOnline.tsx` contains no Supabase call and no engine transition.
- `?turn=` handling has one definition, shared with the lobby's entry-path builder.
- Behaviour parity: turn timers, forfeits, cube flow, bot matches, and reconnect are unchanged.

### Phase 10 completion gate

Reached when 10a–10e are all done:

- No client-generated online dice or client-authoritative outcome is introduced.
- Match, game, and move data never render as mixed snapshot versions.
- Realtime and polling stop after leaving the route.
- Optimistic state rolls back or resynchronizes after failure.
- Duplicate commands do not create duplicate server writes.
- Reconnect, opponent disconnect, AI fallback, and match completion retain current behavior.

## Phase 11: Targeted engine improvements

### Scope

- Review duplication or missing domain concepts discovered during local and online gameplay migrations.
- Change the engine only for a concrete, documented need.
- Add engine tests before changing behavior or public contracts.
- Regenerate the Supabase Edge Function engine mirror after every engine change.
- Validate AI, server move validation, replay reconstruction, local gameplay, and online gameplay.

### Reasoning

The engine is already pure, deterministic, serializable, tested, and shared with server validation. It should remain stable while application state ownership changes.

After both gameplay paths use explicit Redux events and selectors, genuine engine gaps become easier to distinguish from controller or UI problems. Possible valid changes include a canonical turn representation, removal of duplicated transition logic, or improved serialization. A page refactor alone is not a reason to change the engine.

Engine changes have a larger impact than route changes because they affect local play, replay, AI, and the generated server mirror. They therefore require a separate phase and separate review.

### Completion gate

- Every engine change has a failing test or documented duplication motivating it.
- Server mirror generation is clean.
- Engine, AI, replay, local gameplay, and server validation checks pass.
- No Redux or application dependency enters `packages/engine`.

## Phase 12: Cleanup and enforcement

### Scope

- Remove compatibility contexts, hooks, and adapters after their final consumers migrate.
- Remove obsolete manual caches, refresh counters, duplicated query functions, and direct component-level Supabase reads.
- Remove dead state and actions identified through Redux DevTools and tests.
- Add lint or boundary checks for the Redux architecture.
- Document the final feature template and testing policy.

Recommended enforceable boundaries:

- Components may use generated RTK Query hooks and typed Redux hooks, but do not construct ad hoc caches.
- Slices do not import Supabase, React, Pixi, or navigation APIs.
- Feature API modules inject into the shared base API.
- `store/listenerMiddleware.ts` contains no listener effects — only `start<Feature>Listeners()` calls.
- A migrated route's Supabase access lives in its feature directory, not in `lib/`.
- Server data is not duplicated in slices.
- Non-serializable service objects never enter actions or state.
- Gameplay rules remain in the engine.

### Reasoning

Compatibility layers are necessary for incremental migration but become architectural debt after migration. Removing them too early forces a big-bang rewrite; leaving them indefinitely creates two competing state systems.

Automated boundaries convert the migration's conventions into lasting project rules. Strictness should come from enforceable ownership and serializable events, not only from team memory.

### Completion gate

- Redux Toolkit and RTK Query are the only player-app global state and server-cache systems.
- No migrated component performs direct Supabase reads.
- No deprecated compatibility state owner remains.
- Lint, boundary checks, tests, and builds pass.
- The final architecture is documented with one reference feature.

## Delivery strategy

Each phase should be independently deployable. Within a phase, prefer small pull requests that preserve public interfaces:

1. Add the new endpoint, slice, selectors, or listener.
2. Add reducer, selector, endpoint, and workflow tests.
3. Adapt the existing hook or provider to the new owner.
4. Migrate consumers one at a time.
5. Remove the old owner only after the last consumer moves.

Do not combine these high-risk changes in one pull request:

- State migration and engine refactor.
- RTK Query migration and visual redesign.
- Realtime rewrite and gameplay-rule changes.
- Authentication migration and account-storage policy changes.
- Cache ownership changes and unrelated performance optimization.

This sequence intentionally builds Redux knowledge on low-risk routes, establishes shared player-data and invalidation contracts, migrates the large Lobby in two layers, and reaches gameplay only after the required Redux patterns have already been proven.