# CSS Modules Migration Plan and Phase Reports

## High-level goal

The final architecture uses co-located CSS Modules with descriptive camelCase
locals, plus a small set of true global styles for document-level and
cross-cutting contracts. Keyframes move with their owning component. Repeated
styles become shared layout or client components rather than duplicated module
rules. Tailwind is removed completely at the end: no Tailwind classes,
directives, layers, `@apply`, configs, or dependencies remain. Engine and
package boundaries remain respected throughout.

## Complete migration plan

1. **Inventory and ownership:** map semantic selectors, Tailwind utilities,
   keyframes, media queries, data attributes, dynamic class construction, and
   every consumer; classify rules as component-owned, shared, or truly global.
2. **Component extraction:** create the smallest co-located CSS Modules for
   ordinary component-owned rules, moving their keyframes and responsive rules
   with them while preserving behavior and variants.
3. **Shared-component extraction:** turn repeated styling into shared layout or
   client components and update every consumer; do not copy shared rules into
   multiple modules.
4. **Feature slices:** migrate wheel/daily bonus, dice, profile, lobby, and
   gameplay ownership in conservative slices, recording newly discovered
   consumers and legacy selectors after each slice.
5. **Global cleanup:** remove migrated rules from `index.css`, retaining only
   document base styles, shared tokens, and intentional cross-cutting
   contracts.
6. **Game Tailwind utility conversion:** convert all remaining utilities in
   `apps/game/src/**/*.{ts,tsx}` into descriptive module or true-global styles.
7. **Admin and shared-package conversion:** convert utilities in
   `apps/admin/src/**/*.{ts,tsx}`, `packages/board-renderer/src/**/*.{ts,tsx}`,
   and `packages/board-preview/src/**/*.{ts,tsx}`.
8. **Tailwind configuration and dependency removal:** remove `@tailwind` and
   `@config` directives from game/admin CSS; delete `tailwind.config.js` and
   `tailwind.admin.config.js`; remove Tailwind from `postcss.config.js` and
   delete that config if unused; remove `tailwindcss`, `autoprefixer`, and
   `postcss` only after all utility/directive usage is gone, then update the
   lockfile.
9. **Verification:** run lint, TypeScript/build checks, boundary checks,
   `git diff --check`, and manual responsive/interaction checks for each slice
   and at the end.

Temporary Tailwind classes are migration scaffolding. They must be converted,
not copied into modules or hidden in modules through `@apply` or Tailwind
layer wrappers.

## Chronological phase reports

### Discovery and baseline

- The migration began from the large `apps/game/src/index.css` monolith. The
  initial discovery recorded 10,113 lines. During the pilot, the source
  evolved; the later recorded baseline was approximately 10,281 lines and the
  post-cleanup file is approximately 9,659 lines, an observed reduction of
  about 622 lines. These are historical observations, not interchangeable
  exact baselines.
- The source inventory identified roughly 960 semantic selectors, 28 keyframes,
  and 31 media blocks, in addition to Tailwind entry directives and global
  document rules.
- The migration decisions were: use camelCase CSS Module locals; move every
  keyframe with its owner; extract shared layout/components instead of
  duplicating shared rules; preserve dynamic state/variant behavior with
  explicit module mappings; and retain intentional cross-cutting selectors as
  globals.
- CSS Modules replace Tailwind. Tailwind may remain temporarily while slices
  are migrated, but final removal includes game, admin, board-renderer, and
  board-preview source rather than only the game app.

### S1 — CSS Modules configuration and environment check

- Changed `apps/game/vite.config.ts` to set
  `css.modules.localsConvention: "camelCaseOnly"`.
- The initial full-build attempt exposed an environment-native dependency
  problem: `lightningcss.linux-arm64-gnu.node` is missing. This remains a
  build-environment blocker and is not a migration result.

### S2 — Report, inventory, and ownership remediation

- Established this report as the hand-off inventory and defined a repeatable
  slice recipe: inventory selectors and consumers, classify ownership, extract
  the smallest module, convert references, remove only migrated global rules,
  verify, and record the result.
- S2.1 clarified ownership and legacy handling: component-specific rules move
  to the owner; repeated rules require a shared component/layout; unused
  selectors are not moved merely because they are large or complex.
- S2.2 preserved dynamic behavior through explicit size/state/variant module
  mappings rather than rebuilding hashed class names.
- S2.3 documented the exact consumer map used for the remaining slices:

  - **Wheel/daily bonus:** `lobby/WheelModal.tsx` consumes the pre-S7 global
    selectors `wheel-modal-backdrop`, `wheel-modal-rise`, and
    `wheel-winning-wedge`; their current CSS Module locals are
    `wheelModalBackdrop`, `wheelModalRise`, and `wheelWinningWedge`.
    `lobby/HourlyBonusWidget.tsx` consumes the pre-S7 global
    `lobby-hourly-bonus*` names, now mapped to the `HourlyBonusWidget.module.css`
    locals `hourlyBonus`, `image`, `readyImage`, `pill`, `readyPill`,
    `cooldownPill`, and `unavailablePill`; `lobby/DailyBonusModal.tsx` consumes
    the pre-S7 global selector `daily-bonus-active-frame`, now the CSS Module
    local `activeFrame`. `lobby/DailyMissionsModal.tsx` is a direct
    daily-mission consumer, but its `dmx`/mission/streak styles come from its
    local `DM_STYLES`, not `index.css`. The wheel/daily-bonus rules have no
    other direct JSX consumers found.
  - **Dice:** `components/DiceTray.tsx` is the only direct consumer of
    `.dice-*`. `lobby/DailyMissionsModal.tsx` uses a dice asset but no
    `.dice-*`; `modals/Shop/ShopModal.tsx` has no direct dice/shop selector consumer.
  - **Profile:** `pages/Profile.tsx` consumes `.profile-*`,
    `.lobby-profile-progress*`, and `.lobby-currency-*`; it also has duplicate
    currency markup. `components/CurrencyPill.tsx` consumes
    `.lobby-currency-*`; `lobby/LobbyTopBar.tsx` consumes
    `.lobby-currency-strip`; `modals/Shop/ShopModal.tsx` renders `CurrencyPill`. The
    currency rules therefore need shared-component/layout treatment. No direct
    consumer was found for `.lobby-profile-card`,
    `.lobby-profile-avatar-*`, `.lobby-profile-copy`, and related legacy rules.
  - **Lobby:** direct `lobby-*` consumers are
    `lobby/LobbyScreen.tsx`, `lobby/LobbyTopBar.tsx`,
    `lobby/LobbyBottomNav.tsx`, `lobby/LobbyBoardCarousel.tsx`,
    `lobby/LobbyProfileCard.tsx`, `lobby/LobbyActionCard.tsx`,
    `lobby/LobbySideOffers.tsx`, `lobby/HourlyBonusWidget.tsx`, and
    `lobby/Sunbeam.tsx`. `components/CurrencyPill.tsx` and
    `pages/Profile.tsx` also consume shared currency classes. `.lobby-pp*` is
    localized to `LobbyProfileCard`.
  - **Gameplay:** direct `game-*` consumers are
    `components/BoardLayout.tsx`, `components/SidePanel.tsx`,
    `components/MatchHeader.tsx`, `components/TurnTimerBar.tsx`,
    `components/ActionButtons.tsx` (including cube/double controls), and
    `components/AutoRollToggle.tsx`. `components/DiceTray.tsx` consumes
    `.dice-*`; gameplay ownership and dice overlap must be rechecked before
    extraction.

### S3 — Pilot extraction and remediations

- Added these co-located modules:
  - `apps/game/src/components/PlayButton.module.css`
  - `apps/game/src/components/UnlockPill.module.css`
  - `apps/game/src/components/LoadingScreen.module.css`
- Updated the corresponding components:
  - `apps/game/src/components/PlayButton.tsx`
  - `apps/game/src/components/UnlockPill.tsx`
  - `apps/game/src/components/LoadingScreen.tsx`
- S3.1 used descriptive locals with no `gr` namespace: `playButton`,
  `unlockPill`, `loadingScreen`, and their related camelCase descendants.
  PlayButton preserves `sm`/`md`/`lg`, block sizing, optional sparkles, shimmer,
  text shine, hover behavior, and forwarded button props. UnlockPill preserves
  lock/gem variants, expand/button modes, controlled open state, outside
  interaction behavior, and per-instance SVG gradient IDs. LoadingScreen
  preserves synchronous artwork loading, progress clamping/label behavior,
  deterministic progress transforms, and the animated fallback bar.
- S3.2 retained Tailwind utility classes as temporary scaffolding where they
  were not part of the extracted semantic pilot rules. They are not the final
  architecture and must be converted later.

### S4 — Name pill and fullscreen-modal contract remediation

- Added `apps/game/src/lobby/LobbyBoardCarousel.module.css` and updated
  `apps/game/src/lobby/LobbyBoardCarousel.tsx`. The board name pill is now the
  descriptive `styles.namePill`; the carousel still preserves podium layering,
  cross-fade behavior, pointer-event behavior, and PlayButton/UnlockPill
  interactions.
- Updated `apps/game/src/lib/bodyModalFlag.ts` and
  `apps/game/src/lobby/Sunbeam.tsx` to use the consistent
  `data-fullscreen-modal` / `dataset.fullscreenModal` contract.
- The modal writers/owners remain `features/shop/ShopHost.tsx` and
  `lobby/LobbyScreen.tsx` through `useBodyModalFlag`; `lobby/Sunbeam.tsx` is
  the reader. The global pause selectors and PlayButton selector were renamed
  consistently. This contract pauses known background animation while a
  full-screen modal is open.

### S5 — Global cleanup

- Removed the pilot semantic rules and owned keyframes from
  `apps/game/src/index.css`; document base styles, Tailwind directives, and
  intentional cross-cutting selectors remain for later phases.
- Deleted unused `apps/game/src/App.css`.
- The pilot rules/keyframes were not duplicated in global CSS or modules with
  Tailwind layers. Shared and legacy ownership findings remain recorded above.

### S6 — Verification

- `npm run lint`: passed, exit 0.
- `tsc -b apps/game/tsconfig.json tsconfig.node.json`: passed as the first
  stage of `npm run build`.
- `git diff --check`: passed with no output.
- Source-level pilot checks confirmed PlayButton size/sparkle variants,
  UnlockPill lock/gem and expanded states, LoadingScreen progress handling,
  carousel `namePill`, and the fullscreen-modal contract.
- The browser/manual visual pass was not run; this did not establish absence
  of visual regressions.

### S6.1 — PostCSS layer remediation and latest build state

- The first Vite/PostCSS verification reported invalid `@layer components`
  wrappers in `PlayButton.module.css` and `UnlockPill.module.css`: those
  modules no longer had matching Tailwind component layers. The wrappers were
  removed from both modules.
- This fixed the PostCSS layer error. The latest full Vite build proceeds past
  PostCSS but remains blocked later by the missing
  `lightningcss.linux-arm64-gnu.node` binary. The build did not pass and is not
  build-verified.
- The exact pilot files changed/new/deleted across this work are:
  `apps/game/vite.config.ts`, `apps/game/src/index.css`,
  `apps/game/src/components/PlayButton.tsx`,
  `apps/game/src/components/PlayButton.module.css` (new),
  `apps/game/src/components/UnlockPill.tsx`,
  `apps/game/src/components/UnlockPill.module.css` (new),
  `apps/game/src/components/LoadingScreen.tsx`,
  `apps/game/src/components/LoadingScreen.module.css` (new),
  `apps/game/src/lobby/LobbyBoardCarousel.tsx`,
  `apps/game/src/lobby/LobbyBoardCarousel.module.css` (new),
  `apps/game/src/lib/bodyModalFlag.ts`, `apps/game/src/lobby/Sunbeam.tsx`,
  and deleted `apps/game/src/App.css`. The existing unrelated `.env` was not
  touched and must remain out of this migration.

## Current resumable state

- **Completed:** S1 through S9, including the pilot, name-pill/modal contract,
  selective global cleanup, wheel/daily-bonus, modern DiceTray, and profile
  CSS Module slices.
- **Pending:** full lobby and gameplay migration; remaining Tailwind conversion
  across game/admin/packages; Tailwind config and dependency removal; lockfile
  update; final `build:all` verification; and the intentionally retained legacy
  `.game-*` dice CSS.
- **Manual checks pending:** browser visual, responsive, animation, pointer,
  modal-pause, and interaction checks for the completed slices and each future
  slice.
- **Exact next recommended slice:** lobby only, after confirming ownership and
  consumers; do not include the legacy `.game-*` dice block in that slice.
- **Final migration checks still required:** inspect all four Tailwind-scanned
  source roots for remaining utilities/directives before removing configs and
  dependencies, then run `npm run build:all`.

### S11 — LobbyProfileCard CSS Module slice

- Moved the used `lobby-pp-*` rules from `apps/game/src/index.css` into
  `apps/game/src/lobby/LobbyProfileCard.module.css`, renaming the opaque `pp`
  prefix to the descriptive `profilePill*` locals (`profilePill`, `profilePillShine`,
  `profilePillContent`, `profilePillIdentity`, `profilePillAvatarWrap`,
  `profilePillAvatarRing`, `profilePillAvatarImg`, `profilePillSpark`/`Spark1`/`Spark2`,
  `profilePillShield`, `profilePillXpBar`/`XpFill`/`XpFillBubbles`/`XpText`).
- Updated `LobbyProfileCard.tsx` with a direct module import and explicit mappings;
  the `group` Tailwind class and inline XP width remain. The `lobby-progress-flow-*`
  keyframes stay global (shared with `.lobby-profile-progress-*`).
- Removed only the migrated rules from `index.css`. The unused legacy `lobby-pp-*`
  rules (name/rank/stats/coin/etc., not consumed by the component) remain as dead
  legacy, consistent with the plan's "unused selectors are not moved" rule.
- `lobby-pp-shell` in `LobbyTopBar.tsx` has no CSS rule (dead class) and is out of
  scope for this slice.
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json
  tsconfig.node.json`, and `git diff --check`. Browser/manual visual checks and the
  full build (blocked by the known native Lightning CSS dependency) remain unverified.

#### S11 reviewer remediation

- **Global keyframes:** the XP bubble animations referenced the shared global
  `lobby-progress-flow-slow`/`-fast` keyframes. Since a CSS Module scopes bare
  animation names, both are now explicitly marked `global(...)` so they resolve to
  the global keyframes (which correctly stay in `index.css` for the
  `.lobby-profile-progress-*` consumers).
- **Spark modifier specificity:** restored the original two-class specificity by
  writing `.profilePillSpark.profilePillSpark1` / `.profilePillSpark2` instead of
  single-class variants.
- **Opaque custom props:** renamed `--lobby-pp-radius`/`--lobby-pp-pad` to
  `--profile-pill-radius`/`--profile-pill-pad` (internal to the module).
- **Root positioning:** kept normal-specificity `position: relative` on
  `.profilePill` — exact parity with the original `.lobby-pp-card`; there is no
  caller positioning utility, so the R2 `:where()` contract does not apply here.
- Re-verified: lint, `tsc -b`, `git diff --check` all pass.

#### S11b — LobbyActionCard / LobbySideOffers / Sunbeam modules

- `Sunbeam.module.css` — `lobby-sunbeam-canvas` → `sunbeamCanvas`.
- `LobbyActionCard.module.css` — `lobby-action-card/icon/title/subtitle` →
  `actionCard/actionIcon/actionTitle/actionSubtitle` plus the descendant rules
  (`.actionIcon img`, `.actionIcon > span`, `.actionCard > span.relative.min-w-0`,
  `.actionCard > span:last-child`).
- `LobbySideOffers.module.css` — `lobby-offers` → `offers`, `lobby-offers--right` →
  `offersRight` (dynamic `side` prop now maps to `styles.offersRight`), the
  `lobby-offer-card` `:has(> img)` / `:not(:has(> img))` variants → `offerCard`,
  and `lobby-offer-arrow` → `offerArrow`. The shared `.lobby-offers,
  .lobby-action-stack` rule was folded into `.offers` (the action-stack half is
  dead — no TSX consumer — and its standalone rule at index.css:1271 was left in
  place).
- Removed the migrated rules from `index.css`. Remaining `lobby-*` refs there are
  only comments and the dead `.lobby-action-stack` rule.
- Verified: lint, `tsc -b`, `git diff --check` all pass. Browser/manual visual
  checks and the full build (blocked by the known native Lightning CSS dependency)
  remain unverified.

#### S11b reviewer remediation

- **Tailwind utility descendants scoped as module locals (p1):** descendant
  selectors that referenced Tailwind classes (`.relative`, `.min-w-0`, `.grid`)
  were being CSS-Module-scoped, so they no longer matched the literal Tailwind
  classes in the DOM. Rather than reach into utility classes with `:global(...)`
  (spaghetti), each descendant element was given its own descriptive module class
  and styled directly:
  - `LobbyActionCard`: text container → `actionBody`, chevron → `actionChevron`.
  - `LobbySideOffers`: icon → `offerIcon`, text container → `offerBody`, title →
    `offerTitle`, subtitle → `offerSubtitle`. These classes only exist in the
    non-image branch, so the old `:not(:has(> img))` descendant prefixes were
    dropped; the card-level `:has(> img)` / `:not(:has(> img))` sizing rules stay.
- Re-verified: lint, `tsc -b`, `git diff --check` all pass.

#### S11c — Tailwind decomposition of migrated modules

Decomposed the Tailwind utility piles out of `className` in every migrated
component, making each CSS module the single source of truth (no more
order-dependent cascade between module rules and Tailwind utilities).

- `LobbyActionCard` — all utilities + tone gradients (`toneBlue/Green/Purple`
  via custom props), hover/active/disabled, `2xl` media query.
- `LobbySideOffers` — responsive `aside` (mobile media query), `offerCard`
  base + states, `offerImage`, `offerGlare`, extended icon/body/title/subtitle,
  tone classes (`toneCoins/Daily/Connect`); removed the dead `tone` field from
  `lobbyData.ts`.
- `LobbyProfileCard` — removed dead `group` (no `group-hover`).
- `LoadingScreen` — `loadingScreenRoot/Bg/Pct`.
- `DailyBonusModal` — reward chips, day-card (ribbon/check/top/header/divider/
  rewards/claim), modal (title/subtitle/grid/error).
- `WheelModal` — backdrop/rise/title-plate/frame/pointer/rings/disc/divider/
  slot/hub/spin/error (inline `--wheel-d` styles stay).
- `LobbyBoardCarousel` — podium/section/viewport/stage/board/image/name-pill/
  dots + lock/gem pill wrap positioning (global `lobby-carousel-*` classes
  remain — separate migration).
- `Profile` — loading, delete-link, local `CurrencyPill` (pill/icon/value/add/
  plus), stat icon/value; `profilePage` now sets `color:#fff`; `text-center`
  was already in the module.
- `PlayButton` was already clean (size/block map to module classes).

Remaining `className` tokens are module classes or true global classes
(`lobby-carousel-*`, `lobby-profile-progress*`, `lobby-currency-*`) — no
Tailwind utilities remain in any migrated component. Verified: lint, `tsc -b`,
`git diff --check` all pass. Browser/manual visual checks and the full build
(blocked by the known native Lightning CSS dependency) remain unverified.

#### S11f — styling skill

Created `.claude/skills/css-modules/SKILL.md` codifying the styling rules
established during this migration: co-located CSS Modules, module as single
source of truth, named descendant classes (no `:global()` spaghetti), shared
styles via `composes:` (no `--var` design tokens), keyframes placement,
Tailwind removal mapping, and the verification block (lint / tsc / diff-check /
build). Discovered by pi via `.pi/settings.json` → `../.claude/skills`.

#### S11e — `.textWhite` shared class

Added `.textWhite { color: #fff }` to `shared.module.css` and composed it into
8 rules across 5 modules (LobbySideOffers, LobbyActionCard, LobbyProfileCard,
DailyBonusModal ×2, Profile ×3). Rules already composing `fontDisplay` now
carry a second `composes` line. `background-color: #fff` and near-white
`#fff7cd`/`#fff8c7` left as-is (different concerns). Verified: build passes,
`.textWhite` emitted once.

#### S11d — shared declared styles via `composes`

Extracted repeated styles into `apps/game/src/styles/shared.module.css` and
composed them into consumers with CSS Modules `composes:` (no CSS custom
properties — user preference).

- Created `shared.module.css` with `.fontDisplay` (the `font-display` stack).
- Composed `fontDisplay` into 13 rules across 6 modules (LobbySideOffers,
  LobbyBoardCarousel, LobbyActionCard, WheelModal ×3, DailyBonusModal ×5,
  Profile ×2). `composes` must be the first declaration, so each rule was
  restructured.
- `index.css` is a global stylesheet (not a module) so it can't `composes`;
  its 3 `font-family` occurrences were left as-is.
- Verified in the built CSS: the shared class is emitted once
  (`._fontDisplay_ozrpf_4`) and composed into consumers.

**Build unblocked (pre-existing index.css bugs, not from this work):** the
full build was previously blocked by a missing native Lightning CSS module;
once that cleared, two latent syntax errors surfaced in `index.css` (both in
HEAD, unrelated to the migration):
- Unclosed comment at line 221 that swallowed the `.lobby-profile-progress-label`
  rule → added the missing `*/`.
- Stray `}` at line 1078 (double closing brace) → removed it.

`npm run build` now passes. lint, `tsc -b`, `git diff --check` all pass.

#### S11 shared-keyframes extraction

- Created `apps/game/src/keyframes.css` (next to `index.css`) to hold the shared
  keyframes used by more than one consumer. Moved `lobby-progress-flow-slow` and
  `lobby-progress-flow-fast` there (used by the global `.lobby-profile-progress-*`
  rules and the `LobbyProfileCard` module). Imported `keyframes.css` in `main.tsx`
  alongside `index.css` so the keyframes stay in global scope for the module's
  `global(...)` references. Component-owned keyframes remain with their owning
  module; only cross-consumer keyframes live in `keyframes.css`.

### R2 — Positioning contract regression remediation

- **Symptom:** The migrated PlayButton was no longer visible in its board-center
  position; the same cascade risk affected UnlockPill and the carousel name pill.
- **Root cause:** Removing the invalid Tailwind component layers left each
  module's `position: relative` at normal specificity, allowing it to override
  caller-owned absolute positioning utilities based on stylesheet order.
- **Affected controls:** PlayButton wrapper, UnlockPill wrapper, and carousel
  `namePill`.
- **Durable fix:** Each default `position: relative` now lives in a local
  `:where(...)` selector, giving it zero specificity while preserving all other
  module declarations and allowing caller positioning to win.
- **Files:** `apps/game/src/components/PlayButton.module.css`,
  `apps/game/src/components/UnlockPill.module.css`,
  `apps/game/src/lobby/LobbyBoardCarousel.module.css`.
- **Verification:** `npm run lint`, `npm exec -- tsc -b
  apps/game/tsconfig.json tsconfig.node.json`, and `git diff --check` passed.
  The production build was attempted but did not complete in this environment;
  the known native Lightning CSS dependency blocker remains unresolved, so
  build-level CSS-module verification is not claimed.

### S7 — Wheel and daily-bonus CSS Module slice

- Moved the daily-bonus `@property`, spin keyframes, active-frame gradient and
  glow from `apps/game/src/index.css` to
  `apps/game/src/lobby/DailyBonusModal.module.css`; moved the wheel backdrop,
  rise, winning-wedge keyframes, animations, and reduced-motion rules to
  `apps/game/src/lobby/WheelModal.module.css`.
- Updated `DailyBonusModal.tsx` and `WheelModal.tsx` with direct module imports.
  Dynamic active/claimed/locked composition, Tailwind utilities, inline styles,
  imperative wheel rotation, and modal behavior remain unchanged. The existing
  `HourlyBonusWidget.tsx` and `HourlyBonusWidget.module.css` work was present
  and preserved.
- Removed only the corresponding wheel-modal and daily-bonus global rules from
  `index.css`; `.lobby-bottom-nav-slot--hourly` and the body fullscreen-modal
  contract remain global.
- Browser visual verification was not run. The known native Lightning CSS
  dependency blocker remains, so a successful full build is not claimed.

### S8 — DiceTray CSS Module slice

- Moved the active modern `.dice-*` rules from `apps/game/src/index.css` to
  `apps/game/src/components/DiceTray.module.css` and updated `DiceTray.tsx`
  with explicit module mappings for board placement, stand state, cube sprite
  mode, face variants, and pip descendants.
- The legacy `.game-*` dice block intentionally remains pending and unowned;
  it is outside this slice. `DiceTray.tsx` remains the only direct `.dice-*`
  consumer found. `rollId`, cumulative inline transforms, forced
  `offsetHeight` reflow, inline `--dice-sprite-url`, theme sprite behavior, and
  component semantics were preserved.
- `diceTiming.ts` now points at `DiceTray.module.css`. Tailwind utilities in
  `PlayOnline.tsx` and `HotSeat.tsx` were not changed.
- Browser visual, responsive/interaction, and full-build verification remain
  unverified; the known native Lightning CSS dependency blocker remains.

### S9 — Profile CSS Module slice

- Moved profile-owned styling from `apps/game/src/index.css` into
  `apps/game/src/pages/Profile.module.css`, including responsive media behavior,
  profile layout custom properties, and append-only profile overrides.
- Retained shared `.lobby-currency-*` and `.lobby-profile-progress*` contracts,
  their progress keyframes, fullscreen-modal pause rules, and unrelated
  `.lobby-pp-*` LobbyProfileCard rules in global CSS.
- Updated `Profile.tsx` with a direct module import and explicit typed maps for
  stat-card size, stat-icon, match-icon, and history-outcome variants. The XP
  modifier remains composed with shared progress classes; links, actions,
  accessibility, inline progress width, and component semantics are preserved.
- Browser visual/responsive verification and successful full-build verification
  remain unverified; the known native Lightning CSS dependency blocker remains.

### S10 — Applied slice state and verification

- The migration now applied in this branch includes these co-located modules and
  component updates: `PlayButton.module.css` / `PlayButton.tsx`,
  `UnlockPill.module.css` / `UnlockPill.tsx`,
  `LoadingScreen.module.css` / `LoadingScreen.tsx`,
  `LobbyBoardCarousel.module.css` / `LobbyBoardCarousel.tsx`,
  `HourlyBonusWidget.module.css` / `HourlyBonusWidget.tsx`,
  `DailyBonusModal.module.css` / `DailyBonusModal.tsx`,
  `WheelModal.module.css` / `WheelModal.tsx`,
  `DiceTray.module.css` / `DiceTray.tsx`, and
  `Profile.module.css` / `Profile.tsx`. `diceTiming.ts` now references the
  DiceTray module.
- `apps/game/src/index.css` received selective cleanup for the migrated pilot,
  wheel/daily-bonus, modern dice, and profile-owned rules. Tailwind directives,
  shared globals and contracts, and the legacy `.game-*` dice CSS remain. The
  retained `data-fullscreen-modal` contract is written by
  `features/shop/ShopHost.tsx`/`LobbyScreen.tsx` through `useBodyModalFlag` and read by
  `Sunbeam.tsx` to pause background animation while a full-screen modal is open.
- Verification passed: `npm run lint`, `npm exec -- tsc -b
  apps/game/tsconfig.json tsconfig.node.json`, `npm run build`, and
  `git diff --check`. The build emitted only existing large-chunk warnings.
  Browser/manual visual checks remain pending.
- Full lobby/gameplay migration, remaining Tailwind conversion across
  game/admin/packages, Tailwind config/dependency removal, and final
  `npm run build:all` remain pending.

### S12 — LobbyBottomNav CSS Module slice

- Moved the bottom-navigator + level-lock tooltip + badge styling from
  `apps/game/src/index.css` into `apps/game/src/lobby/LobbyBottomNav.module.css`,
  renaming the `lobby-bottom-nav-*` / `lobby-nav-*` globals to descriptive
  camelCase locals (`bottomNavShell/Bar/Row/Slot`, `bottomNavSlotHourly`,
  `isPlaceholder`/`isLocked`/`isOpen` state locals, `navLockWrap/Lock/Icon/Tip`,
  `navBadge`).
- Consolidated three separate global sources into the module: the base block
  (shell/bar/row/slot/lock/tip/badge), the `--lobby-u` layout overrides
  (`.lobby-bottom-nav-shell` + `.lobby-nav-badge` in the unified layout block),
  and the live `@media (max-width: 640px)` mobile override for the shell. The
  `--lobby-u` override wins the cascade for overlapping props, so the merged
  `.bottomNavShell` carries its values (position:absolute, bottom/width in
  `--lobby-u`, z-index 35); the merged `.navBadge` carries the `--lobby-u`
  top/right/min-width/padding/font-size over the base.
- Moved the component-owned keyframes (`navLockWiggle/Settle/Stretch`) and the
  `prefers-reduced-motion` block into the module with the component.
- Updated `LobbyBottomNav.tsx` with a direct module import and explicit
  mappings; the `is-locked`/`is-open`/`is-placeholder` state classes and the
  `--hourly` slot modifier are now module locals. Component logic (open-lock
  state, outside-tap collapse, gradient ids) unchanged.
- Removed only the migrated rules from `index.css` (base block, hourly-slot
  rule + comment, the two `--lobby-u` overrides, and the 640px shell override).
  The dead legacy `.lobby-bottom-nav-item` / `.lobby-nav-icon` /
  `.lobby-nav-label` rules (no TSX consumer) and the dead
  `.lobby-bottom-nav-frame` rule remain as legacy, consistent with the plan's
  "unused selectors are not moved" rule.
- `lobby-bottom-nav-slot--hourly` was confirmed to have a single consumer
  (`LobbyBottomNav.tsx`); `HourlyBonusWidget` uses its own module, so it moved
  into the module rather than staying global.
- Verification passed: `npm run lint`, `npm exec -- tsc -b
  apps/game/tsconfig.json tsconfig.node.json`, `npm run build`, and
  `git diff --check`. Built CSS confirms the module locals and keyframes are
  emitted. Browser/manual visual checks remain pending.

### S13 — LobbyBoardCarousel globals CSS Module slice

- Folded the remaining live carousel globals into the existing
  `apps/game/src/lobby/LobbyBoardCarousel.module.css`:
  - The `.lobby-carousel-board` custom-property block (`--lobby-next-x`,
    `--lobby-side-scale`, `--lobby-next-rotation`, `--lobby-incoming-next-x`,
    `--lobby-incoming-scale`, `--lobby-incoming-next-rotation`, plus the
    `--lobby-prev-*` set, `transform-origin`, `will-change`) merged into the
    module's `.carouselBoard` rule. Custom properties are not renamed by CSS
    Modules, so the JS `readLayoutFromSample` / `slotWidthPx` reads still work.
  - The podium cross-fade `@keyframes lobbyPodiumFade` + `.lobby-podium-fade-in`
    moved as component-owned `@keyframes podiumFade` + `.podiumFadeIn`.
- Updated `LobbyBoardCarousel.tsx`: dropped the dead `lobby-carousel-section`,
  `lobby-carousel-viewport`, `lobby-carousel-board`, and
  `lobby-carousel-board-image` classes (no global rules existed for them — the
  module classes already carried the styling); `lobby-podium-fade-in` →
  `styles.podiumFadeIn`; and the two `querySelector(".lobby-carousel-board")`
  calls now query `` `.${styles.carouselBoard}` `` so the JS still reads the
  layout custom props off the board element.
- Removed only the live rules from `index.css` (the `.lobby-carousel-board`
  custom-props block and the podium-fade keyframe + rule). Left as dead legacy
  (no TSX consumer): the `[data-slot]` / `[data-motion]` board rules and the
  `lobby-board-*-*` keyframes (the component drives transforms via inline
  `style`, not `data-slot`), `.lobby-carousel-viewport[data-dragging]`, and
  `.lobby-podium-fade-out` + `lobbyPodiumFadeOut`.
- Verification passed: `npm run lint`, `npm exec -- tsc -b
  apps/game/tsconfig.json tsconfig.node.json`, `npm run build`, and
  `git diff --check`. Built CSS confirms `.carouselBoard` carries the custom
  props and `.podiumFadeIn` is emitted. Browser/manual visual checks remain
  pending.

#### S12/S13 reviewer remediation

- **p1 (regression):** the migrated `.bottomNavSlot img` descendant rules were
  emitted after `HourlyBonusWidget.module.css`, so they overrode the hourly
  wheel's own `.image img` sizing/shadow/hover styling (the wheel lives inside
  the nav's center slot). Scoped the nav icon styling to a dedicated
  `navItemImage` class on the direct nav item images (locked + button slots)
  instead of all descendant imgs; the hourly widget's img does not carry that
  class, so it is isolated again. This also satisfies the "name descendants
  directly" rule.
- **p2:** `.navBadge` now `composes: textWhite` from `styles/shared.module.css`
  instead of duplicating `color: white`.
- **p3:** corrected the stale `index.css` comment that claimed the carousel
  slide-position custom properties stayed global; they now live on
  `.carouselBoard` in the module, and only the dead data-slot animation states
  + keyframes remain global.
- Re-verified: lint, `tsc -b`, `npm run build`, `git diff --check` all pass;
  built CSS confirms no broad `.bottomNavSlot img` rule remains, `navItemImage`
  is emitted, and the hourly `.image img` rules are intact.
