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

- Migrate invite joining, public match joining, room entry, and related queue workflows.
- Standardize mutation-to-navigation behavior.
- Reuse matchmaking and player-data endpoints rather than issuing direct Supabase requests from pages.
- Define explicit states for idle, submitting, matched, cancelled, failed, and expired outcomes.
- Keep React Router navigation at the route boundary or behind a narrowly defined navigation service; reducers must not navigate.

### Reasoning

These routes connect Lobby workflows to active gameplay. Migrating them before gameplay establishes a consistent handoff contract: successful entry produces a match identifier and route parameters, while cancellation and failure leave no stale workflow state.

They are less complex than an active match but exercise real server mutations, duplicate-submit protection, loading overlays, and navigation races. Fixing those patterns first reduces the number of concerns introduced during gameplay migration.

### Completion gate

- Duplicate join or room-entry submissions are prevented.
- Cancellation and route exit clear queue state.
- Navigation occurs only after a confirmed server result.
- Gameplay routes receive one documented entry payload.

## Phase 9: Local gameplay

### Scope

- Migrate `useGame` behind a gameplay slice while preserving its external API during transition.
- Store canonical, serializable local-session state: match, board, roll, remaining dice, move history, undo snapshot, and turn records.
- Derive legal origins, valid destinations, action availability, and display status through selectors.
- Model player actions as explicit gameplay events.
- Move cancellable AI and turn-timer workflows into listener middleware.
- Keep the engine unchanged during the state migration.
- Keep Pixi stateless and driven by `BoardState` and selection props.

### Reasoning

Local gameplay is the safest place to prove Redux for a full game session because it has no Realtime reconciliation or server-authoritative dice. By this phase, action, selector, listener, lifecycle, and RTK Query mutation conventions have already been exercised elsewhere.

Keeping the existing engine fixed provides a trusted behavior oracle while the controller changes. Refactoring the engine and its consumer together would make regressions harder to detect.

Derived legal state should not be duplicated in the slice. The pure engine and memoized selectors can calculate it from the canonical snapshot.

### Completion gate

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

### Completion gate

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