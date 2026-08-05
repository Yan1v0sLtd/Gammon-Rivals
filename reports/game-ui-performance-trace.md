# Game UI Performance Trace

## Question

Trace why React spends significant time rendering `SidePanel`, `DiceTray`, `MatchHeader`, and `BoardLayout`.

## Findings

### 1. `BoardLayout` duplicates responsive UI

`BoardLayout` always mounts:

- Two compact `SidePanel`s: `apps/game/src/components/BoardLayout.tsx:65-74`
- Two desktop `SidePanel`s: `apps/game/src/components/BoardLayout.tsx:76-100`

CSS hides one layout rather than unmounting it:

- Mobile panels: `apps/game/src/index.css:4946-4948`
- Desktop side slots: `apps/game/src/index.css:3593-3595`

Therefore React renders four panels, two `Avatar` trees per player, and duplicate timer components even though one layout is invisible.

`TurnTimerBar` runs a 220ms interval: `apps/game/src/components/TurnTimerBar.tsx:20-29`. This timer work is duplicated across the hidden and visible responsive layouts.

### 2. No render bailouts around the main composition

Neither `BoardLayout` nor `SidePanel` is memoized:

- `BoardLayout.tsx:42`
- `SidePanel.tsx:43`

Any parent render traverses all four panel trees, the header, overlays, and board wrappers.

Both pages have many render triggers:

- Hot-seat selectors: `apps/game/src/pages/HotSeat.tsx:260-280`
- Online selectors: `apps/game/src/pages/PlayOnline.tsx:144-166`
- Online polling: `PlayOnline.tsx:108-110`
- Hot-seat local state/effects: `HotSeat.tsx:196-207`, `302-359`

### 3. Parent pages create fresh identities

`HotSeat` creates fresh seat objects, JSX slots, and overlay elements on each render: `apps/game/src/pages/HotSeat.tsx:439-521`.

`PlayOnline` does the same and additionally creates fresh callbacks such as `onRoll`, `onEndTurn`, and cube handlers: `apps/game/src/pages/PlayOnline.tsx:443-455`, `569-581`.

This means simply adding `memo` to `BoardLayout` would not be sufficient unless these props are stabilized.

### 4. `DiceTray` rerenders during every submove

`DiceTray` is not memoized: `apps/game/src/components/DiceTray.tsx:159-165`.

During moves, `remaining` is replaced with a new array:

- `apps/game/src/features/gameplay/gameplaySlice.ts:329-345`
- Online optimistic updates: `apps/game/src/features/onlineMatch/onlineMatchApi.ts:163-180`

Consequently `diceToShow()` recomputes on each submove via `[roll, remaining]`: `DiceTray.tsx:165`.

However, this does **not** restart the CSS animation: the animation effect depends on `[rollId, value]`, not `remaining`: `DiceTray.tsx:213-232`. This is likely unnecessary calculation, but not necessarily the major frame-time issue.

Online polling/realtime snapshots may also replace selector inputs and cause recomputation, though structural-sharing behavior was not confirmed.

### 5. `MatchHeader` is probably not the main bottleneck

`MatchHeader` performs only lightweight formatting and navigation-hook setup:

- `apps/game/src/components/MatchHeader.tsx:23-43`

It is not memoized and gets recreated through fresh parent JSX:

- Hot-seat: `HotSeat.tsx:479-486`
- Online: `PlayOnline.tsx:540-547`

`PlayOnline` also creates a new `headerMatch` object every render: `PlayOnline.tsx:420-428`.

These are real avoidable renders, but the header has no timers, effects, expensive children, or asynchronous work. Its own cost is unlikely to explain substantial rendering time.

## Priority order

1. **Remove CSS-hidden duplicate panel trees**, or conditionally mount only the active responsive layout.
2. **Eliminate duplicated `TurnTimerBar` intervals** from hidden panels.
3. Stabilize page-level JSX/object/callback props and add memoization around `BoardLayout`/`SidePanel`.
4. Profile or reduce `DiceTray` recomputation on submoves.
5. Memoize `MatchHeader` as a lower-priority cleanup.

## Ambiguities

No browser profiler or render-count trace was available, so the relative CPU cost is unmeasured. The strongest confirmed issue is the duplicated responsive panels and timer intervals; the exact contribution of polling, selectors, avatars, and reconciliation requires runtime profiling.
