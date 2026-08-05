---
name: redux-integration
description: Use when adding, changing, or reviewing player-app state in apps/game/src — Redux Toolkit slices, RTK Query endpoints, selectors, listener middleware workflows, Supabase data access, or anything under apps/game/src/store or apps/game/src/features. Also use when migrating a route off lib/ hooks, contexts, manual caches, useEffect fetching, or component-owned timers/polling.
---

# Redux integration rules (player app)

Authoritative and self-contained conventions for state in `apps/game/src`.
Everything needed to write correct code is in this file — do not copy patterns
from nearby files, and do not treat an existing file as the spec. If a file in
the repo disagrees with this document, this document wins and the file is a
migration leftover.

## What to do, in order

1. **Classify the value** you are adding with the ownership table below. This
   decides the file you write, before you write anything.
2. **Pick or create the feature directory** `apps/game/src/features/<feature>/`.
   List that directory first; add to existing files rather than inventing a
   parallel one.
3. **Write bottom-up**: `<feature>Data.ts` → `<feature>Api.ts` → `<feature>Slice.ts`
   → `<feature>Selectors.ts` → `<feature>Listeners.ts` → component. Skip the
   layers you do not need; never skip a layer by inlining it into the one above.
4. **Register side effects once**: add the tag type to `store/baseApi.ts`, the
   reducer to `store/store.ts`, the listener registration to
   `store/listenerMiddleware.ts`. These three files are the only shared edits.
5. **Delete what you replaced.** No shim, no re-export, no "keep for now" copy.
   Update every importer in the same change.
6. **Run the verification block** at the bottom and fix everything it reports.

## The two owners

- **Redux Toolkit** owns application state. One store: `apps/game/src/store/store.ts`.
- **RTK Query** owns the server cache. One `createApi`: `apps/game/src/store/baseApi.ts`.

Nothing else. No Zustand, TanStack Query, MobX, second `createApi`, module-level
cache object, context that holds state, or `useEffect` that fetches. Ask before
adding any state, cache, or form library.

## Where a value belongs

| Value | Owner |
| --- | --- |
| Server row / RPC result | RTK Query cache, via a feature endpoint |
| State two unrelated subtrees read, or that outlives the route | Feature slice (or the app-wide UI slice) |
| Anything derivable from the above | Selector, never state |
| Form draft, edit mode, hover, pressed button, animation flag | `useState` in the component |
| Auth tokens, refresh, OAuth | Supabase, not Redux |
| Game rules, legal moves, pip counts | `packages/engine`, not Redux |

Rule of thumb: if you are about to `useState` + `useEffect` a server value, you
want an endpoint. If you are about to copy an endpoint result into a slice, stop —
add a selector instead.

## Feature directory layout

One directory per feature: `apps/game/src/features/<feature>/`.

| File | Role |
| --- | --- |
| `<feature>Slice.ts` | `createSlice`. Serializable client state only. |
| `<feature>Selectors.ts` | `createSelector` derivations, including reads of the query cache. |
| `<feature>Api.ts` | `baseApi.injectEndpoints` + the exported generated hooks. |
| `<feature>Data.ts` | Supabase reads / writes / RPC wrappers. Plain async functions. |
| `<feature>Listeners.ts` | `start<Feature>Listeners(startListening)` — cancellable workflows. |
| `<feature>Actions.ts` | `createAction` events no single slice reduces (cross-feature). |
| `<feature>Errors.ts` | Error → user-facing message mapping. |

Split a role across several files when it covers more than one concern — e.g. a
feature with two independent workflows gets `fooListeners.ts` and
`barListeners.ts` instead of one 400-line module. Keep the role suffix in the
name.

**No barrel files and no re-export shims.** Import the exact module:

```ts
import {useGetWalletQuery} from '../features/playerData/playerDataApi'
```

## Data access (`<feature>Data.ts`)

The only place `supabase` is called for feature data. Plain async functions that
throw on error; no Redux, React, or RTK Query imports.

```ts
import {supabase} from '../../lib/supabase';
import type {Database} from '../../../../../packages/shared/src/database';

export type WalletRow = Database['public']['Tables']['user_wallets']['Row'];

export async function fetchWallet(userId: string): Promise<WalletRow | null> {
  const {data, error} = await supabase
    .from('user_wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- Import depth: from `features/<feature>/` it is five `../` to reach `packages/`,
  from `lib/` it is four.
- `lib/supabase.ts` stays in `lib/` — it is shared infrastructure, not feature data.
- Row-type aliases over the generated `Database` type are declared locally in the
  file that needs them. Do not import row aliases across feature folders and do
  not create a shared types module for one-line aliases.

## Endpoints (`<feature>Api.ts`)

`baseApi` is built with `fakeBaseQuery<ApiError>()`, so **every** endpoint is a
`queryFn` wrapping a `<feature>Data.ts` function, and every rejection goes through
the shared `toApiError` helper exported from `store/baseApi.ts`.

```ts
import {baseApi, toApiError} from '../../store/baseApi';
import {fetchWallet, type WalletRow} from './playerData';

export const playerDataApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getWallet: build.query<WalletRow | null, string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchWallet(userId)};
        } catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_r, _e, userId) => [{type: 'Wallet', id: userId}],
    }),
  }),
});

export const {useGetWalletQuery} = playerDataApi;
```

- New tag types go in the `tagTypes` array in `store/baseApi.ts`. A tag that is
  not listed there is a silent no-op.
- User-scoped entries are tagged `{ type, id: userId }` so an identity change
  cannot leak another account's data.
- `keepUnusedDataFor` is the tuning knob for prefetched, rarely-changing data
  (catalog/config rows use `1800`). Say why in a comment.
- Skip a query with `skipToken` or `{ skip: userId === null }` rather than
  branching on a fake argument.
- Prefer `invalidatesTags` on the mutation. Use `baseApi.util.invalidateTags`
  from a listener only when the refresh is delayed or spans features.
- Components use the generated hooks. Do not call
  `store.dispatch(endpoint.initiate())` in a component.

## Slices (`<feature>Slice.ts`)

```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Modal choreography: the claimed state is shown this long before it closes. */
export const DAILY_BONUS_CLAIMED_MODAL_MS = 1200;

interface LobbyState {
  modal: {kind: 'none'} | {kind: 'dailyBonus'; day: number};
}

const initialState = (): LobbyState => ({modal: {kind: 'none'}});

const lobbySlice = createSlice({
  name: 'lobby',
  initialState: initialState(),
  reducers: {
    lobbyRouteEntered: () => initialState(),
    dailyBonusClaimSucceeded: (state, action: PayloadAction<{day: number}>) => {
      state.modal = {kind: 'dailyBonus', day: action.payload.day};
    },
  },
});

export const lobbySliceActions = lobbySlice.actions;
export const lobbySliceReducre = lobbySlice.reducer;
```

- Actions are **domain events**: `matchmakingRequested`, `replayRouteEntered`,
  `dailyBonusClaimSucceeded`. Not `setX`, `setData`, `update`.
- `initialState` is a factory so route-exit reducers can reset by calling it.
- Route entry/exit are explicit actions; exit resets slice state and never
  touches the query cache.
- Mutually exclusive UI is one discriminated union, not a bag of booleans.
- Reducers are pure: no Supabase, no navigation, no timers, no AI, no `Date.now()`
  when the value must be reproducible — pass it in the payload.
- **Serializable only.** No `Set`, `Map`, class instance, promise, channel, timer
  handle, AbortController, DOM node, or Pixi object. `store.ts` keeps RTK's
  default serializable + immutable checks with no ignored paths; if a check
  fires, the state shape is wrong — do not add an exception.
- Presentation timing constants shared by the slice and its listener are exported
  from the slice.
- The reducer is the file's default export; actions and constants are named
  exports. Register the reducer in `store/store.ts` under the feature name.

## Selectors (`<feature>Selectors.ts`)

```ts
import {createSelector} from '@reduxjs/toolkit';
import {createEmptyArray} from '../../lib/constants';
import {playerDataApi} from './playerDataApi';
import type {RootState} from '../../store/store';

const selectUserId = (state: RootState) => state.auth.userId;

export const selectWallet = createSelector([selectUserId, (state: RootState) => state], (userId, state) =>
  userId ? (playerDataApi.endpoints.getWallet.select(userId)(state).data ?? null) : null,
);

export const selectBalance = createSelector([selectWallet], (wallet) => wallet?.balance ?? 0);

export const selectLevelConfigs = createSelector(
  [(state: RootState) => state],
  (state): readonly LevelConfig[] => {
    playerDataApi.endpoints.getLevelConfigs.select(undefined)(state).data ?? createEmptyArray<LevelConfig>()
  },
);
```

- Derive; never store. Route params, totals, boards, pip counts, availability
  flags and engine reconstructions are selectors.
- Memoize anything non-trivial or returning a new object with `createSelector`.
- An absent list falls back to `createEmptyArray<T>()` from `lib/constants` — one
  shared `EMPTY_ARRAY` cast to `readonly T[]`, so the reference is stable across
  every selector and subscribers do not re-render. Never a fresh `[]` literal,
  never a new per-module `EMPTY_X` constant.
- Take the argument from the store (e.g. `state.auth.userId`) rather than making
  a parametrised selector — `createSelector` memoizes one entry, so a per-call
  argument thrashes the cache.
- Reading the query cache in a selector via `api.endpoints.x.select(arg)` is
  correct — that is how server data is combined with slice state without copying it.

## Listeners (`<feature>Listeners.ts`)

Every async workflow — timer, delay, poll, retry, Realtime subscription, delayed
invalidation, cross-feature reaction — lives here. Components never own timers or
polling loops.

```ts
import {isAnyOf} from '@reduxjs/toolkit';
import type {AppStartListening} from '../../store/listenerTypes';
import {FOO_DELAY_MS, fooActions} from './fooSlice';

export function startFooListeners(startListening: AppStartListening): void {
  // Per-store scratch state stays in this closure, never at module scope, so
  // two stores (tests, StrictMode remounts) cannot share it.
  let attempts = 0;

  startListening({
    matcher: isAnyOf(fooActions.fooRequested, fooActions.fooCancelled),
    effect: async (action, {cancelActiveListeners, delay, dispatch, getState}) => {
      cancelActiveListeners();
      if (fooCancelled.match(action)) return;

      // Matches the card flip animation; dispatching earlier double-renders it.
      await delay(FOO_DELAY_MS);

      // The user may have signed out during the delay.
      if (getState().auth.userId !== action.payload.userId) return;
      attempts += 1;
      dispatch(/* … */);
    },
  });
}
```

Hard rules:

- Register in `store/listenerMiddleware.ts` with exactly one
  `start<Feature>Listeners(startListening)` call. **That file is a composition
  root: no effect, matcher, or constant may be defined in it.**
- Take the `AppStartListening` type from `store/listenerTypes.ts`
  (`TypedStartListening<RootState, AppDispatch>`). A feature must never import
  `store/listenerMiddleware`, or the import graph becomes a cycle.
- Use the listener API for cancellation and timing: `delay`, `pause`,
  `cancelActiveListeners`, `fork`. Never `setTimeout`/`setInterval`, and never put
  a handle in Redux.
- Fold cancel/route-exit actions into the same listener via `isAnyOf` so one place
  owns both starting and superseding the workflow.
- Swallow `TaskAbortError` — cancellation is not a failure.
- The reducer already ran when the effect starts. Use `getOriginalState()` for the
  pre-action value.
- After an `await delay(...)`, re-check identity/state before dispatching.
- Comment *why* a delay or guard exists (animation choreography, RPC idempotence,
  stale-timer defence). Those comments are the reason the workflow is correct;
  keep them when moving code.

Use an RTK Query cache lifecycle (`onCacheEntryAdded`) instead of a listener when
a subscription's lifetime exactly matches one query's subscribers.

## Components

- Typed hooks only: `useAppDispatch` / `useAppSelector` from `store/hooks.ts`.
- One `<Provider>` at the root in `main.tsx` inside `StrictMode`.
- Components dispatch domain events and read selectors/query hooks. No fetching,
  no cache construction, no timers, no business rules.
- Pixi stays stateless — pass `BoardState` and selection props;
  `BoardRenderer.render(state)` is a view function.

## Migrating a route off `lib/`

Some routes still keep their data layer and hooks in `apps/game/src/lib/`. When
you touch one:

1. Move its Supabase functions into `features/<feature>/<feature>Data.ts`.
2. Wrap them in endpoints in `<feature>Api.ts`; add tags to `store/baseApi.ts`.
3. Move workflows into `<feature>Listeners.ts`; register once in the middleware.
4. Move surviving client state into `<feature>Slice.ts`; derive the rest.
5. Update every importer to the new path and delete the old module — no shim.
6. Do not migrate routes you were not asked to touch. Leaving another route's
   data layer in `lib/` is correct, not debt you must clear.

After migration `lib/` should hold infrastructure only — the Supabase client,
auth/native auth, billing, browser-pipeline and formatting utilities — plus the
data layer of routes nobody has migrated yet.

## Do not

- Copy query data into a slice, or mirror the component tree in the store.
- Create a second `createApi`, a barrel, or a re-export shim.
- Define listener effects in `store/listenerMiddleware.ts`.
- Add ignored paths or disable serializability checks in `store.ts`.
- Put rules logic in a slice or in Pixi, or roll dice client-side for online play.
- Add tests for slices, selectors, endpoints, listeners, components or the
  renderer. Client code is deliberately untested here (`vitest.config.ts` is
  scoped to `packages/**`). If logic deserves a test, it belongs in `packages/`.

## Verify

```sh
npx tsc -b apps/game/tsconfig.json tsconfig.node.json
npx eslint apps/game/src
npm run check:boundaries
npm test
```
