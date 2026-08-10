# Task: Confirm step before offering a double

## Problem

`AGENTS.md` non-negotiable #6 requires a confirm step on the doubling cube:
single-tap cube offers caused user complaints in the reference app (Lord of the
Board). The shipped app has no confirm step. One tap on the Double button sends
the offer:

- `apps/game/src/components/MatchSecondaryControls.tsx:46` — `onClick={canDouble ? onDouble : undefined}` fires immediately.
- `apps/game/src/pages/HotSeat.tsx:220` — `handleOfferDouble` dispatches `gameplayActions.doubleOffered()` with no intermediate state.
- `apps/game/src/pages/PlayOnline.tsx:156` — `offerDouble` calls the `offer_double` RPC through `triggerOfferDouble` with no intermediate state.

The cost of a mis-tap is high and irreversible: the opponent may take, and the
match value doubles for the rest of the game. In online play the offer is also
written to the server and broadcast, so nothing can be undone client-side.

The public website previously advertised the confirm step. That copy was
removed while this task is open (`apps/website/src/pages/rules.astro`,
`apps/website/src/pages/press.astro`) and should be restored when the step
ships.

## Proposed change

Add one shared confirm interaction in front of the existing `onDouble`
callback, used by both match routes.

- The gesture is a two-tap arm/confirm or a long-press, per `AGENTS.md` #6.
  Two-tap is the smaller change and works with the existing button.
- The armed state is short-lived UI state. Keep it local to the control (or in
  the relevant feature slice if it must survive a re-render); it is not match
  state, and no engine or server contract changes.
- Arming must expire on its own (a few seconds), on turn change, on a dice
  roll, and when the cube stops being offerable (`canDouble` goes false).
- The armed button must say what the second tap does and what value it will
  offer (the control already computes `nextCube`).
- The opponent's take/drop prompt stays as it is. This task is only about the
  offering side.

## Relevant code

- `apps/game/src/components/MatchSecondaryControls.tsx` — the Double button, `canDouble`, `nextCube`.
- `apps/game/src/features/gameplay/HotSeatPlayerPanel.tsx` and `apps/game/src/features/onlineMatch/OnlinePlayerPanel.tsx` — pass `onDouble` down to the control.
- `apps/game/src/pages/HotSeat.tsx` — `handleOfferDouble`, local match path.
- `apps/game/src/pages/PlayOnline.tsx` — `offerDouble`, online path (`offer_double` RPC).
- `apps/game/src/features/gameplay/gameplaySlice.ts` — `doubleOffered` reducer.
- `packages/engine/src/match.ts` — cube state and values; unchanged by this task.

## Acceptance criteria

- One tap never sends a double offer in either the local or the online match
  route.
- The confirm gesture is the same in both routes and lives in one component;
  the two pages do not implement it separately.
- A double is offered exactly once per confirmed gesture — no duplicate
  dispatch and no duplicate `offer_double` RPC call.
- The armed state clears on timeout, on turn change, and whenever `canDouble`
  becomes false, so a stale armed button cannot fire into a new turn.
- The armed state is visible and readable: the player can tell the cube is
  armed and can cancel without offering.
- The control remains operable with a keyboard and reports its state to
  assistive technology.
- No changes to `packages/engine`, to the `offer_double` RPC signature, or to
  generated database types.
- After it ships, restore the confirm-step wording on
  `apps/website/src/pages/rules.astro` (doubling cube section) and
  `apps/website/src/pages/press.astro` (features list).

## Scope note

UI-only. Cube rules, scoring, and the take/drop flow stay exactly as they are.
