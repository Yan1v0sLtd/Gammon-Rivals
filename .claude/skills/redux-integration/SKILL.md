---
name: redux-integration
description: Use when adding, changing, or reviewing player-app state in apps/game/src — Redux Toolkit slices, RTK Query endpoints, selectors, listener middleware workflows, Supabase data access, or anything under apps/game/src/store or apps/game/src/features. Also use when migrating a route off lib/ hooks, contexts, manual caches, useEffect fetching, or component-owned timers/polling.
---

# Redux integration rules (player app)

Authoritative conventions for `apps/game/src`. Follow these instead of inferring
patterns from nearby files. Plan status and phase order live in
`reports/redux-migration.md`; the project-wide rules live in `CLAUDE.md`.

## The two owners

- **Redux Toolkit** owns application state. One store, `apps/game/src/store/store.ts`.
- **RTK Query** owns the server cache. One `createApi`, `apps/game/src/store/baseApi.ts`.

Nothing else. No Zustand, TanStack Query, MobX, second `createApi`, module-level
cache object, context that holds state, or `useEffect` that fetches. Ask before
adding any state, cache, or form library.

## Where a value belongs

| Value | Owner |
| --- | --- |
| Server row / RPC result | RTK Query cache, via a feature endpoint |
| State two unrelated subtrees read, or that outlives the route | Feature slice (or `appUi` if app-wide) |
| Anything derivable from the above | Selector, never state |
| Form draft, edit mode, hover, pressed button, animation flag | `useState` in the component |
| Auth tokens, refresh, OAuth | Supabase, not Redux |
| Game rules | `packages/engine`, not Redux |

Rule of thumb: if you are about to `useState` + `useEffect` a server value, you
want an endpoint. If you are about to copy an endpoint result into a slice, stop —
add a selector instead.

## Feature directory layout

One directory per feature: `apps/game/src/features/<feature>/`. Current features:
`appUi`, `auth`, `lobby`, `playerData`, `replay`, `shop`.

| File | Role |
| --- | --- |
| `<feature>Slice.ts` | `createSlice`. Serializable client state only. |
| `<feature>Selectors.ts` | `createSelector` derivations, including reads of the query cache. |
| `<feature>Api.ts` | `baseApi.injectEndpoints` + the exported generated hooks. |
| `<feature>Data.ts` | Supabase reads / writes / RPC wrappers. Plain async functions. |
| `<feature>Listeners.ts` | `start<Feature>Listeners(startListening)` — cancellable workflows. |
| `<feature>Actions.ts` | `createAction` events no single slice reduces (cross-feature). |
| `<feature>Errors.ts` | Error → user-facing message mapping. |

Split a role into more than one file when it has more than one concern
(`lobby` has `dailyBonusListeners.ts` and `matchmakingListeners.ts`;
`playerData` has `playerData.ts` and `matchHistoryData.ts`). Keep the suffix.

**No barrel files and no re-export shims.** Import the exact module:
`import { useGetWalletQuery } from '../features/playerData/playerDataApi';`

Never leave a stub in `lib/` re-exporting a moved module — update every importer.

## Data access (`<feature>Data.ts`)

The only place `supabase` is called for feature data. Plain async functions that
throw on error; no Redux, React, or RTK Query imports.

```ts
import { supabase } from '../../lib/supabase';
import type { Database } from '../../../../../packages/shared/src/database';

export type WalletRow = Database['public']['Tables']['user_wallets']['Row'];

export async function fetchWallet(userId: string): Promise<WalletRow | null> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

Note the depth: from `features/<feature>/` it is five `../` to `packages/`, from
`lib/` it is four. `lib/supabase.ts` stays in `lib/` — it is shared infrastructure.

Row-type aliases over the generated `Database` type are declared locally in the
file that needs them. Do not import row aliases across feature folders and do not
create a shared types module for one-line aliases.

## Endpoints (`<feature>Api.ts`)

Every endpoint is a `queryFn` wrapping a `<feature>Data.ts` function, because
`baseApi` uses `fakeBaseQuery<ApiError>()`. Errors go through `toApiError`.

```ts
import { baseApi, toApiError } from '../../store/baseApi';
import { fetchWallet, type WalletRow } from './playerData';

export const playerDataApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getWallet: build.query<WalletRow | null, string>({
      queryFn: async (userId) => {
        try {
          return { data: await fetchWallet(userId) };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: (_r, _e, userId) => [{ type: 'Wallet', id: userId }],
    }),
  }),
});

export const { useGetWalletQuery } = playerDataApi;
```

- Add new tag types to the `tagTypes` array in `store/baseApi.ts`.
- User-scoped entries are tagged `{ type, id: userId }` so identity changes cannot
  leak another account's data.
- `keepUnusedDataFor` is the tuning knob for prefetched, rarely-changing data
  (catalog/config use 1800). Say why in a comment.
- Skip a query with `skipToken` or `{ skip: userId === null }` rather than
  branching on a fake argument.
- Prefer `invalidatesTags`. Use `baseApi.util.invalidateTags` from a listener only
  when the refresh is delayed or spans features.
- Components use the generated hooks. Do not call `store.dispatch(endpoint.initiate())`
  in a component.

## Slices (`<feature>Slice.ts`)

```ts
const initialState = (): LobbyState => ({ modal: { kind: 'none' }, ... });
```

- Actions are **domain events**: `matchmakingRequested`, `replayRouteEntered`,
  `dailyBonusClaimSucceeded`. Not `setX`, `setData`, `update`.
- Route entry/exit are explicit actions; exit resets slice state and never touches
  the query cache.
- Mutually exclusive UI is one discriminated union (`modal: { kind: 'none' } | { kind: 'dailyBonus', … }`),
  not a bag of booleans.
- Reducers are pure: no Supabase, no navigation, no timers, no AI, no `Date.now()`
  when the value must be reproducible — pass it in the payload.
- **Serializable only.** No `Set`, `Map`, class instance, promise, channel, timer
  handle, AbortController, DOM node, or Pixi object. The store keeps RTK's default
  serializable + immutable checks with no ignored paths; if a check fires, the state
  shape is wrong — do not add an exception.
- Presentation timing constants that the slice and its listener share
  (`DAILY_BONUS_CLAIMED_MODAL_MS`) are exported from the slice.

## Selectors (`<feature>Selectors.ts`)

- Derive; never store. Route params, totals, boards, pip counts, availability flags
  and engine reconstructions are selectors.
- Memoize anything non-trivial or returning a new object with `createSelector`.
- Return a module-level stable empty array/object instead of a fresh `[]` literal.
- Reading the query cache in a selector is correct — that is how server data is
  combined with slice state without copying it.

## Listeners (`<feature>Listeners.ts`)

Every async workflow — timer, delay, poll, retry, Realtime subscription, delayed
invalidation, cross-feature reaction — lives here. Components never own timers or
polling loops.

```ts
import type { AppStartListening } from '../../store/listenerTypes';

export function startFooListeners(startListening: AppStartListening): void {
  startListening({
    actionCreator: fooRequested,
    effect: async (action, { cancelActiveListeners, delay, dispatch, getState }) => {
      cancelActiveListeners();
      await delay(FOO_DELAY_MS);
      if (getState().auth.userId !== action.payload.userId) return;
      dispatch(/* … */);
    },
  });
}
```

Hard rules:

- Register in `store/listenerMiddleware.ts` with exactly one
  `start<Feature>Listeners(startListening)` call. **That file is a composition
  root: no effect, matcher, or constant may be defined in it.**
- Take the `AppStartListening` type from `store/listenerTypes.ts`. A feature must
  never import `store/listenerMiddleware`, or the import graph becomes a cycle.
- Use the listener API for cancellation and timing: `delay`, `pause`,
  `cancelActiveListeners`, `fork`. Never `setTimeout`/`setInterval`, and never put
  a handle in Redux.
- Fold cancel/route-exit actions into the same listener via `isAnyOf` so one place
  owns both starting and superseding the workflow.
- Swallow `TaskAbortError` — cancellation is not a failure.
- The reducer already ran when the effect starts. Use `getOriginalState()` for the
  pre-action value, and keep per-store scratch values in a closure inside
  `start<Feature>Listeners` (not module scope) so each store gets its own.
- After an `await delay(...)`, re-check identity/state before dispatching — the user
  may have changed.
- Comment *why* a delay or guard exists (animation choreography, RPC idempotence,
  stale-timer defence). These comments are the reason the workflow is correct;
  keep them when moving code.

Use an RTK Query cache lifecycle (`onCacheEntryAdded`) instead of a listener when a
subscription's lifetime exactly matches one query's subscribers.

## Components

- Typed hooks only: `useAppDispatch` / `useAppSelector` from `store/hooks.ts`.
- One `<Provider>` at the root in `main.tsx` inside `StrictMode`.
- Components dispatch domain events and read selectors/query hooks. No fetching, no
  cache construction, no timers, no business rules.
- Pixi stays stateless — pass `BoardState` and selection props; `BoardRenderer.render(state)`
  is a view function.

## Migrating a route off `lib/`

1. Move its Supabase functions into `features/<feature>/<feature>Data.ts`.
2. Wrap them in endpoints in `<feature>Api.ts`; add tags to `baseApi`.
3. Move workflows into `<feature>Listeners.ts`; register once in the middleware.
4. Move surviving client state into `<feature>Slice.ts`; derive the rest.
5. Update every importer to the new path and delete the old module — no shim.
6. Keep unmigrated routes working: leave their data layer in `lib/` until their
   phase lands (`lib/persistence.ts`, `lib/identity.ts`, `lib/aiPersona.ts` are
   still owned by the unmigrated gameplay routes).

`lib/` keeps infrastructure only: `supabase.ts`, auth/native auth, `billing/`,
browser-pipeline and formatting utilities, plus the data layer of unmigrated routes.

## Do not

- Copy query data into a slice, or mirror the component tree in the store.
- Create a second `createApi`, a barrel, or a re-export shim.
- Define listener effects in `store/listenerMiddleware.ts`.
- Add ignored paths / disabled serializability checks to `store.ts`.
- Put rules logic in a slice or in Pixi, or roll dice client-side for online play.
- Add tests for slices, selectors, endpoints, listeners, components or the
  renderer. Client code is deliberately untested here (`vitest.config.ts` is scoped
  to `packages/**`). If logic deserves a test, it belongs in `packages/`.

## Verify

```
npx tsc -b apps/game/tsconfig.json tsconfig.node.json
npx eslint apps/game/src
npm run check:boundaries
npm test
```
