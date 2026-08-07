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

### S14 — Profile XP progress family CSS Module slice

- Moved the live `.lobby-profile-progress*` family from `apps/game/src/index.css`
  into `apps/game/src/features/profile/ProfileMainCard.module.css` as descriptive
  locals: `.xpBar` (track), `.xpBarFill`, `.xpBarBubbles` (+`::after`), `.xpBarLabel`,
  plus the `.xpBarWide` widening modifier (renamed from `.profileXpWide`).
- The bubbles animations now reference the shared keyframes via
  `animation: global(lobby-progress-flow-slow/fast) ...` (they live in
  `keyframes.css`; bare names would be module-scoped).
- Updated `ProfileMainCard.tsx`: the four literal legacy classes
  (`lobby-profile-progress`, `-fill`, `-bubbles`, `-label`) are now module locals;
  the `:global(...)` composition in the module (the last global↔module coupling)
  is gone. Keyframe references remain, but no `.lobby-profile-progress*` class
  is referenced from TSX anywhere.
- Cascade parity preserved: the legacy lobby-u override block (index.css:426/441,
  `position:absolute; left:0` + `var(--lobby-u)` sizes) is carried into the module
  as later same-class `.xpBar` / `.xpBarLabel` rules. On the profile page
  `--lobby-u` is never defined, so only `position:absolute; left:0` and
  `letter-spacing:0` compute; the `var()` sizes are invalid-at-computed-value
  and drop — identical computed behavior to the old global cascade. Built CSS
  confirms both rules emit in the same order and `.xpBar.xpBarWide` (0,2,0)
  still wins width/height/display.
- The `body[data-fullscreen-modal]` pause rule moved into the module as
  `:global(body[data-fullscreen-modal]) .xpBarBubbles[, ::after]` (the same
  data-fullscreen-modal contract already used by PlayButton/HourlyBonusWidget).
- Removed only the migrated live rules from `index.css` (base family 147–247,
  lobby-u overrides 426–444, pause 6115–6116). The dead `.lobby-profile-progress-text`
  no-op rules (150/329/502) and stale comments remain as legacy for the purge slice.
- **Discovered issue (flagged for the pending visual check):** the legacy lobby-u
  override leaks `position:absolute; left:0` onto the profile page (its `--lobby-u`
  sizes are dead there, and the profile page has no positioned ancestor for the bar).
  The historical `.profileXpBar` was `position:relative` in-flow, so this looks like
  a lobby-card leak, not intended profile styling. Preserved verbatim for parity;
  if the visual check shows the bar misplaced, deleting the override rule in
  `ProfileMainCard.module.css` (making `.xpBar` stay relative) is the fix.
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json
  tsconfig.node.json`, `npm run build`, `git diff --check`. Built CSS (Profile chunk)
  confirms `_xpBar*` locals emit, the global keyframes resolve, and the
  data-fullscreen-modal pause targets the module-scoped bubbles class.
  Browser/manual visual checks remain pending.

#### S14 reviewer remediation

- Removed the three dead `.lobby-profile-progress-text` no-op rules from
  `index.css` (base 150-152, lobby-u block 329-331, 640px media 502) — no
  consumer exists anywhere (their own comments said "no longer in markup"),
  so the "safety no-op" rationale is void.
- Fixed stale keyframe-ownership comments: `keyframes.css` header and
  `LobbyProfileCard.module.css` bubble comment claimed the keyframes lived
  "in index.css alongside the `.lobby-profile-progress-*` styles"; both now
  point at `keyframes.css` and the migrated module consumers. The stale
  mention at `index.css:5669` sits inside the comment-only region that Slice
  B (dead-lobby purge) deletes wholesale.
- Reviewer confirmed cascade parity (base family, lobby-u override ordering,
  label override, fullscreen-modal pause, landscape/portrait widen variants)
  and zero missed consumers.
- Re-verified: lint, `tsc -b`, `npm run build`, `git diff --check` all pass.
  Browser/manual visual checks (including the flagged `position:absolute;
  left:0` leak question) remain pending.

### S15 — Dead-lobby purge (index.css slimming)

- Deleted all remaining dead lobby content from `apps/game/src/index.css`:
  - `.lobby-profile-*` base block + lobby-u override block, `.lobby-profile-copy > button`,
    orphaned HourlyBonusWidget/Google-CTA comments, `.lobby-action-stack`,
    `.lobby-bottom-nav-item`/`.lobby-nav-*`/`.lobby-bottom-nav-frame` overrides, and the
    `/* end unified lobby layout block */` marker.
  - Empty `@media (max-width: 900px)` and `@media (orientation: portrait)` blocks, the
    dead 640px mobile lobby block, and the comment-only Profile-v2 / Google-CTA /
    landscape comment blocks.
  - The dead tail: `@property --daily-bonus-rotate` + `@keyframes daily-bonus-spin`
    (DailyBonusModal.module.css has its own local copy), the comment-only DiceTray /
    Wheel / profile notes, four empty profile media queries, the `.lobby-pp-*` premium
    card block, `@property --gr-shimmer` + `gr-*` keyframes, and the migrated
    PlayButton/UnlockPill/LoadingScreen comment tail.
- File went 5,976 → 4,458 lines (−1,518: 1,516 deleted lobby lines + two
  trailing blank lines after the gameplay block, stripped for `git diff --check`).
  Remaining content: Tailwind directives,
  document base (`html, body, #root`), and the gameplay block only. Zero
  `.lobby-*`/`.dice-*`/`.wheel-*`/`.daily-*` rules remain.
- Safety verified before deletion: whole-repo grep for every dead prefix found only
  comments or the DailyBonusModal module's own migrated `--daily-bonus-rotate`.
- Content parity verified mechanically: the surviving gameplay block (HEAD lines
  728–5166) diffs rule-identical against the post-deletion file; `wc` math checks
  (5,976 − 707 − 809 = 4,460 pre-whitespace-strip, then −2 trailing blanks = 4,458).
- Built CSS confirmed: live `game-*` rules intact (game-screen, game-table-plate,
  game-actions-layer ×9, game-dice-tray, …), dead lobby selectors absent.
- The intentionally retained legacy gameplay-dead rules (`.game-dice-*`/`.game-die-*`
  block + keyframes, `.game-decor`, `.game-table-plate`, `.game-header-action*`,
  `.game-score-strip`, etc.) remain in place for the Slice C gameplay migration, which
  will delete them while moving live rules into modules.
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json
  tsconfig.node.json`, `npm run build`, `git diff --check` (after stripping one trailing
  blank at EOF). Browser/manual visual checks remain pending.

### C0 — Dead gameplay purge (index.css slimming)

- Deleted all dead `.game-*` content from `apps/game/src/index.css` (no consumer anywhere in apps/packages — verified by grep):
  - Pass 1: `.game-table-plate`, `.game-home-icon` base + `::before`/`::after`, `.game-score-strip` + `::before`,
    `.game-header-actions` + `.game-header-action`/`.game-header-icon`/`--stats`/`--settings`,
    the whole legacy dice block (`.game-dice-tray*`, `.game-dice-stage`, `.game-die*`, `.game-die-side*`,
    `@keyframes game-die-flight/-tumble/-shadow`, `@media (prefers-reduced-motion)`), `.game-decor`/`--glass`/`--cup`.
  - Pass 2: `.game-home-icon` + `::before`, `.game-score-rail` + `--left`/`--right` (+ their comments),
    `.game-header-actions`, `.game-header-icon-button` + `img`, `.game-player-frame-art` (the `display:none` safety rule),
    `.game-player-neon-rail` + `--left`/`--right`.
  - Pass 3: `.game-home-icon`, `.game-header-actions`, `.game-header-icon-button`, `.game-player-frame-art`,
    `.game-player-neon-rail` + mirrors, `.game-score-rail` (`display:none` rule + comment), `.game-player-frame-art` again.
  - Media-query edits (in-place, not whole-block): removed `.game-header-actions`/`.game-new-match-button` from the
    ≤760px hide list, the `.game-score-strip` rule in that block, the `.game-home-icon` rule, and the `.game-score-strip`
    + `::before` rules in the landscape-≤1023px block, and the dead `.game-match-header .game-header-actions,` line from
    the pass-2 pointer-events list.
- Dropped dead classNames: `game-stat-row--pip/--score/--doubles` in `PlayerStatRow.tsx` (no CSS rules existed — the
  variants did nothing), and the `is-safe` tone in `TurnTimerBar.tsx` (no CSS rule).
- `apps/game/src/index.css` went 4,458 → 3,896 lines (562 deleted). Brace/paren balance verified; zero dead selectors
  remain in source and in the built CSS. Remaining content: Tailwind directives, base styles, and live gameplay rules.
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json tsconfig.node.json`,
  `git diff --check`, `npm run build` (only the existing chunk-size warning). Browser/manual visual checks remain
  pending.

### C1 — AutoRollToggle CSS Module slice

- Created `apps/game/src/components/AutoRollToggle.module.css` and updated `AutoRollToggle.tsx` with a direct module
  import. Both variants are now module-only (zero Tailwind, zero `game-auto-*` literals):
  - **Inline variant** (the only variant used in production — `HotSeatPlayerPanel.tsx:56`,
    `OnlinePlayerPanel.tsx:121`): locals `autoToggle` (+`:hover`/`:active`), `autoSwitch`, `autoKnob`, `autoLabel`,
    and the `on` state class. Pulled per-selector from all four passes of `index.css`, preserving the load-bearing
    cascade order: pass-1 base → landscape-≤1023px media block → the `.game-controls-secondary .game-auto-*` slot-fill
    reflow (folded in as plain locals — the inline variant always renders inside
    `.game-controls-secondary > .game-auto-slot`, so the descendant context is unconditional) → pass-2 art-led grid
    (43%/1fr columns, green ON switch, knob slide) → pass-3 calibration/precision (grid 1fr + rows auto/auto,
    z-index 270, pointer layering).
  - **Panel variant** (unused in production, kept for API parity): decomposed its Tailwind pile into `panelToggle`,
    `panelSwitch` (+`.on` amber state), `panelKnob` (translate-x-5 / translate-x-0.5), `panelState`, `panelLabel`
    (+`.panelToggle:hover .panelLabel` replacing `group-hover:`).
  - Added `.actionButtonReset` to `styles/shared.module.css` (the shared cube/double/roll/auto reset: border,
    gradient background, gold text, fontDisplay, uppercase, transition) and composed it into `.autoToggle`. The
    temporary global grouped rule in `index.css` still carries the reset for cube/double/roll until C3 composes it.
- Removed the migrated rules from `index.css` (14 edits): the base toggle/switch/knob/label family, the three
  `game-auto-toggle` lines from the grouped reset/hover/active rules, the auto-toggle parts of the landscape-≤1023px
  media block (grouped height/width rules slimmed to double/roll and double), the four
  `.game-controls-secondary .game-auto-*` descendant rules + their comment (slot rules stay global), the pass-2
  art-led toggle family, and the pass-3/pointer precision toggle/label/switch rules (the grouped pointer-events and
  z-index lists slimmed to action-row buttons + slot).
- Retained global for C3 (MatchSecondaryControls): `.game-auto-slot` rules (square-slot sizing, `auto.webp`
  background art, aspect-ratio 500/493, media 2866) — the slot element is rendered by MatchSecondaryControls, not
  by the toggle.
- `apps/game/src/index.css` went 3,896 → 3,696 lines. Brace balance verified; zero `.game-auto-toggle/switch/knob/
  label` rules remain in source or built CSS; `.game-auto-slot` rules intact.
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json tsconfig.node.json`,
  `git diff --check`, `npm run build`. Built CSS (`useAutoRoll` chunk) confirms the module locals, the composed
  `actionButtonReset` (emitted once), the media query (minified to `width<=1023px`), and the `.on` state selectors
  (green switch, knob slide, amber panel state). Browser/manual visual checks remain pending.

### C2 — TurnTimerBar + PlayerStatRow CSS Module slices

- Created `TurnTimerBar.module.css` and `PlayerStatRow.module.css`; both components now import their module directly and
  use hashed locals exclusively (zero `game-turn-timer-*` / `game-stat-*` literals remain in TSX).
- **Side-mirror resolution (the cross-module dependency)**: each leaf now carries its own side variant class instead of
  relying on `.game-player-panel--left/--right` ancestor selectors (hashed module classes can't match across files).
  - `TurnTimerBar` already had a `side` prop — `game-turn-timer--${side}` becomes `styles.right` on the same element;
    `.game-player-panel--right .game-turn-timer{...}` folds to `.right.timer` (compound, same 0,2,0 specificity) and
    `.game-turn-timer--right ...` folds to `.right.timer` / `.right .icon`.
  - `PlayerStatRow` gained a `side?: "left" | "right"` prop (default "left") applied as `styles.sideRight` on the row;
    `.game-player-panel--right .game-stat-row/icon/copy` fold to `.sideRight.row` / `.sideRight .icon` / `.sideRight
    .copy`; `.game-player-panel--right.game-compact-panel ...` compact mirrors fold to `.sideRight.compactRow` /
    `.sideRight .compactIcon` / `.sideRight .compactCopy`.
  - Wrappers thread side internally from their existing `seat` prop (PipCountStat, ScoreStat, SpectatorPipCountStat);
    DoublesStat gained a `seat` prop (now `SeatProps`) since it had none — two call sites updated
    (HotSeatPlayerPanel, OnlinePlayerPanel). OnlinePlayerPanel's direct spectator `PlayerStatRow` calls pass `side` too.
- **Media-1081 `.game-mobile-players` folds**: the mobile timer/compact-stat overrides were folded into the modules
  scoped to `.compact.timer` / `.compact .*` / `.right.compact.timer` under the identical `(max-width: 760px),
  (orientation: portrait)` query — exact because the `game-mobile-players` wrapper renders iff the compact variant is
  active (same `useIsMobileLayout()` source).
- **Specificity preserved**: `.right.timer`/`.sideRight.row` compounds keep 0,2,0; `.timer strong`/`.copy strong`
  descendants keep 0,1,1; `:last-child`/`:first-of-type` keep 0,2,0; media-620 label/value overrides and both
  `--timer-progress` `scaleX(var(--timer-progress, 1))` consumption sites (pass-1 180ms + pass-2 220ms transitions)
  moved verbatim. Pass order 1 → media-1081 → 2 → 3 → 3-cont → 4 → media-620 preserved within each module.
- Removed the migrated rules from `index.css` (15 exact-block deletions): pass-1 stat/icon/copy/label/strong +
  compact family + timer family, the media-1081 compact-stat and mobile-players timer blocks, pass-2 art-led stat rows
  + timer (incl. `left-timer.webp`/`right-timer.webp` art, right-icon colors), pass-3/3-cont/4 calibration + precision
  rules, and the media-620 label/value/timer blocks. `.game-stat-list` / `.game-compact-stat-list` stay global
  (PlayerPanelShell owns them — C6 scope).
- `apps/game/src/index.css` went 3,696 → 3,083 lines. Brace balance verified; zero `.game-turn-timer-*`/`.game-stat-*`
  rules remain in source or built CSS (the only remaining `game-compact-stat` is the C6 list selector).
- Verification passed: `npm run lint`, `npm exec -- tsc -b apps/game/tsconfig.json tsconfig.node.json`,
  `git diff --check`, `npm run build`. Built CSS (`useAutoRoll` chunk) confirms: module locals emitted, compound
  `.right.timer`/`.sideRight.row` mirrors (pass-1 border, pass-2 right-timer art + icon, pass-3/4 positions),
  `.right.compact.timer` media fold, `--timer-progress` consumed twice, and both media queries present (minified to
  `width<=760px` / `height<=620px`). Browser/manual visual checks remain pending.

### C2 review fixes (reviewer agent)

- **p1 — compact timer state selectors**: `.compact .timer strong` (descendant chain) never matched — the `<strong>`
  is a DIRECT child of the timer root (there is no nested `.timer` element). Rewrote all three occurrences
  (base `display:none`, media `display:block`, media color/font-size) as `.compact.timer strong` — specificity
  (0,2,1) equals the original `.game-turn-timer.is-compact strong`.
- **p2 — pass-2 `.right.timer` grid-columns**: folding `.game-turn-timer--right` (0,1,0) into `.right.timer` (0,2,0)
  made its `grid-template-columns: 17% minmax(0,1fr) 26%` beat the later pass-3-cont/pass-4 side-agnostic grid-cols
  rules, pinning the right player's timer columns to the pass-2 value. The property was redundant in the original
  cascade (later `.game-turn-timer` rules always re-set columns for both sides), so it was dropped from the module's
  pass-2 right rule — final columns now resolve to the same `20% minmax(0,1fr) 25%` / media-620 `16% minmax(0,1fr)
  auto` as before.
- **p2 — warning/danger fill specificity**: `.game-turn-timer.is-warning .game-turn-timer-fill` (0,3,0) was folded
  to `.warning .fill` (0,2,0); restored exact parity with `.timer.warning .fill` / `.timer.danger .fill` (0,3,0).
- **p2 — orphaned comment**: the pass-4 "narrower invisible icon column" comment sat above the unrelated
  `.game-actions-layer` rule after the stat-row deletion; removed (the rationale already lives in
  `PlayerStatRow.module.css` pass-4 copy).
- **Accepted drift (documented, not fixed)**: `.game-player-panel--right.game-compact-panel .game-compact-stat-row/
  icon/copy` (0,3,0) fold to `.sideRight.compactRow` / `.sideRight .compactIcon` / `.sideRight .compactCopy`
  (0,2,0). Reproducing 0,3,0 would require an ancestor panel class that belongs to PlayerPanelShell's future module;
  since no rule at ≥0,2,0 sets those properties on compact rows (the only competitors are `.compactRow` (0,1,0)
  base/media rules), the resolved styles are identical.
- Re-verified after fixes: lint, `tsc -b`, `npm run build`, `git diff --check` all pass; built CSS confirms
  `._compact_nv5uo_2._timer_nv5uo_2 strong` (display none/block), `.timer.warning/danger .fill` (0,3,0 compounds),
  right-timer rules free of grid-columns, and zero `game-turn-timer`/`game-stat-*` selectors.

### C3 — MatchSecondaryControls + ActionButtons CSS Module slices

- Created `ActionButtons.module.css` and `MatchSecondaryControls.module.css`; both components now use only hashed
  locals. DOM ownership confirmed: ActionButtons renders `actionRow`/`primary`/`rollButton`/`pair`/`pairButton`;
  MatchSecondaryControls renders `secondary`/`cubeButton`/`doubleButton`/`autoSlot`. Zero `game-action-*` /
  `game-controls-*` / `game-auto-slot` / `game-end-turn-pair` literals remain in TSX or index.css.
- **Shared resets folded in (C1's "temporary" global rule fully dies)**:
  - `actionButtonReset` (composed) — covers the old pass-1 grouped reset for cube/double/roll.
  - New `actionButtonChrome` in shared.module.css — the old pass-2 four-way grouped rule (position:relative,
    display:grid, min-w/h:0, place-items, padding:0, overflow:visible, color, border:0, background longhands,
    box-shadow:none, uppercase), placed AFTER `actionButtonReset` so its longhands beat the reset shorthand.
    Composed into rollButton/cubeButton/doubleButton (both resets) and autoSlot (chrome only).
  - `composes` needed the `from "../styles/shared.module.css"` clause (build caught the missing reference first try).
- **Cascade preserved**: modules follow index.css line order exactly — pass-1 → portrait media → 1023-media → pass-2 →
  pass-3 → 1.95/1-media → pass-4. Load-bearing media interleave verified in built CSS (`_actionRow` resolves:
  pass-1 drop-shadow → portrait scale(.86) → 1023 filter/gap/width → pass-2 filter:none/transform:none →
  pass-3 flex/gap 3.15%/z-index 121 → 1.95/1 gap 4.6% → pass-4 pointer-events:none !important).
- **C7 grouped-rule splits**: the three rules grouping `.game-actions-inner` with action-row/button/auto-slot were
  split — index.css keeps the `.game-actions-inner` halves (pass-3 auto + pass-4 none, standalone rules), the
  ActionButtons halves move to its module, the auto-slot halves to MatchSecondaryControls'. Order-safe per-module
  since each file keeps its own rules in source order.
- **Specificity preserved**: `.primary .rollButton`/`.pairButton` (0,2,0, incl. the `background: center / contain
  no-repeat` shorthand whose reset is undone by the (0,3,0) state-image rules — verified in built CSS), `.primary
  button:not(:disabled):hover` (0,2,2), `.secondary > .*` (0,2,0) compounds, `.secondary .* > strong/span` (0,2,1).
  Cascade-dead rules (e.g. the whole 1023-media double/roll block, `.rollButton` pass-2 image) kept verbatim for
  parity, same as C2.
- Removed migrated rules from `index.css` (text-anchored, assert-once purge script): pass-1 controls block, portrait
  media action-row, 1023-media controls block, pass-2 controls block, pass-3 block (replaced with the standalone
  `.game-actions-inner` rule), 1.95/1-media action-row + auto-slot, pass-4 block (replaced with `.game-actions-inner`
  none rule). `index.css` went 3,081 → 2,590 lines; braces balanced (331/331); only `.game-actions-layer` /
  `.game-actions-inner` / `.game-board-column` / `.game-side-slot` controls-adjacent rules remain (C6/C7 scope).
- Verification passed: `npm run lint`, `tsc -b`, `git diff --check`, `npm run build`. Built CSS asserts: zero global
  leftovers in every chunk; module locals emitted (useAutoRoll chunk); composed `_actionButtonReset_` +
  `_actionButtonChrome_` emitted once per chunk; compound mirrors and the `!important` pointer-events/z-index chain
  intact; media minified to `width<=760px`, `width<=1023px`, `aspect-ratio>=1.95`. `background:transparent` →
  `background:0 0` is lightningcss's own minification (equivalent shorthand) — not a regression. Browser/manual
  visual checks remain pending.

### C3 review fixes (reviewer agent)

- **p2 — stale selector documentation**: AutoRollToggle.module.css still referenced the deleted global selectors
  `.game-controls-secondary > .game-auto-slot` in the inline-variant comment. Reworded to describe the structural
  relationship ("the secondary controls' auto slot") without dead selector names.
- **p1 — verification output**: re-ran lint, `tsc -b`, `git diff --check`, and a fresh `npm run build` after the fix
  and attached stdout: all pass, `✓ built in 2.32s`. Fresh built-CSS asserts on the new chunk (useAutoRoll-D0amDZCA):
  zero global `game-action-*`/`game-controls-*`/`game-auto-slot`/`game-end-turn-pair` selectors; locals
  `_rollButton_1db6e_17`/`_cubeButton_1syvm_7`/`_autoSlot_1syvm_56`/`_primary_1db6e_2` etc. + composed
  `_actionButtonReset_1xgle_11`/`_actionButtonChrome_1xgle_23`; the grouped `.primary .rollButton, .primary
  .pairButton` (0,2,0) shorthand rule, both `.actionRow button` `!important` rules (pass-3 auto, pass-4 z-270),
  `.actionRow{pointer-events:none!important}` and pass-2 `filter:none` — all present in the same cascade order.

### C4 — MatchHeader CSS Module slice

- Created `MatchHeader.module.css`; rewritten `MatchHeader.tsx` to hashed locals. All 18 MatchHeader-exclusive
  classes confirmed (no other TSX uses them): `header`/`navHome`/`homeLink`/`homeImage`/`hud`/`hudRow`/`hudPill`/
  `hudArt`/`label`/`scorePlayer`(+Left/Right)/`scoreCore`/`scoreSeparator`/`turnPill`/`turnDot`/`crawfordPill`.
- **Cascade preserved verbatim**: pass-1 (143-325) → 1024-media → 1500-media → portrait → 1023-media → pass-2 →
  pass-3 → pass-4 → 1.95/1-media. The load-bearing `display: none !important` (pass-1 hud) still precedes pass-2/4
  `display: flex`; media interleave intact. `.hud` resolution verified in built CSS across all 9 rule positions.
- **Grouped-rule splits**: `.game-stage, .game-match-header` (pass-2 absolute/inset/block/min-height) → index.css
  keeps `.game-stage`, module gets `.header`. The pointer-events compound
  (`.header .navHome, .header .hud, .header a, .header button`) moves whole — all four selectors are
  MatchHeader-scoped (the bare `a`/`button` elements stay unscoped, matching original specificity). Minifier merged
  the split `.header` rule with the pointer-events rule (same specificity, adjacent — safe).
- index.css purge (text-anchored, assert-once): 2,590 → 1,900 lines (−690). `.game-actions-inner`/
  `.game-board-column`/`.game-side-slot` untouched; `.game-stage` survives the split; braces 251/251.
- Verification: lint, `tsc -b`, `git diff --check`, `npm run build` (`✓ built in 2.34s`). Built-CSS asserts: zero
  global `game-match-*`/`game-score-*`/`game-turn-*`/`game-home-*`/`game-nav-*` leftovers; all 18 module locals in
  the useAutoRoll chunk (`_header_18abm_5`, `_hud_18abm_40`, `_scoreCore_18abm_106`, …); `.hud` cascade order
  pass-1 none!important → media → pass-2 flex → pass-3 → pass-4 z-62 → aspect; pointer-events compound with all 4
  selectors; `scoreCore:before/:after` (single-colon form is the minifier's) incl. pass-3 `display:none!important`;
  `turnPill > span:nth-child(2)`. TSX has zero `game-*` literals. Browser/manual visual checks remain pending.

### C4 review fixes (reviewer agent)

- **p2 — stale banner comment**: the "Premium gameplay precision pass" banner still listed "header" among its
  subjects though all header rules moved to MatchHeader.module.css. Trimmed to "side panels, timers, and tap
  targets." (index.css:1506). The second reference at index.css:1851 points at the section name, which still exists.
- **p2 — report-entry scope**: reviewer flagged the C4 entry in this tracking document as scope drift. The report is
  the migration's working tracker and every slice (S1-S15, C0-C3) appended its entry as part of the accepted
  process; kept, no code impact.
- **p2 — verification output**: re-ran lint, `tsc -b`, `git diff --check`, fresh `npm run build` (`✓ built in
  2.38s`) with stdout attached. Fresh built-CSS asserts on useAutoRoll-C_VXXpWI: zero global leftovers; `.hud`
  none!important@9968 < flex@14992; pointer-events compound with all 4 selectors; `turnPill>span:nth-child(2)`;
  `scoreCore:before/:after` `display:none!important` — all present.

### C5 — PlayerIdentityBlock CSS Module slice

- Created `PlayerIdentityBlock.module.css`; rewrote `PlayerIdentityBlock.tsx` to hashed locals. All 17 identity
  classes confirmed exclusive to this component (avatar-stage/ring/clip/image, level-shield, player-identity,
  player-line, meta-icon/flag + level/coin, compact-avatar-stage/image/level/identity/name/details/line/meta +
  level/flag/coin).
- **Side-mirroring via `side` prop (C2 precedent)**: the old `.game-player-panel--left/--right .X` parent-scoped
  selectors (which depended on PlayerPanelShell's global class, C6) are replaced by `.left`/`.right` variant classes
  applied to the avatar-stage and identity elements, threaded through a new required `side: "left" | "right"` prop.
  Compounds (`.right.avatarStage`) and descendants (`.right .avatarRing`) preserve original specificity (0,2,0).
  Callers: SelfIdentityBlock hardcodes `side="right"` (self panel is always right); HotSeatPlayerPanel + OnlinePlayerPanel
  opponent blocks pass `side="left"`.
- **Dropped dead `textAlign` prop**: it was always `"text-center"` with no `.text-center` rule (Tailwind removed) —
  a no-op. Removed the prop + all 3 call sites per the "drop dead utilities" rule.
- **Cascade preserved verbatim**: pass-1 (base + compact) → 1024-media compact → pass-2 → pass-3 → pass-4 → pass-5 →
  aspect-media avatar-stage → 620-media identity. `.avatarStage` resolution verified across all 5 passes + aspect
  media in built CSS.
- index.css purge (text-anchored, assert-once): 1,900 → 1,083 lines (−817). `.game-stat-list`/`.game-player-top`/
  `.game-player-panel--left/--right`/`.game-side-slot`/`.game-compact-panel`/`.game-compact-top`/`.game-compact-stat-list`
  untouched (C6 scope). Braces 148/148.
- Verification: lint (fixed one import-order error), `tsc -b`, `git diff --check`, `npm run build` (`✓ built in
  2.33s`). Built-CSS asserts: zero global identity leftovers; all 17 module locals in the useAutoRoll chunk
  (`_avatarStage_135ki_10`, `_levelShield_135ki_37`, `_playerIdentity_135ki_55`, …); side compounds/descendants
  (`.right.avatarStage`, `.right .avatarRing`, `.right .levelShield`, `.right .playerLine`, `.right .metaIconLevel`,
  `.right.compactAvatarStage`, `.right .compactLevel`, `.right .compactLine`, `.left.playerIdentity`,
  `.right.playerIdentity`); `avatarImage` grouped selector, `levelShield:before`, `playerLine>:last-child`,
  `playerIdentity h2`; media blocks (1024/1.95/620) present. Browser/manual visual checks remain pending.

### C5 review fixes (reviewer agent)

- **p1 — compact media breakpoint inverted**: the compact rules live in `@media (orientation: landscape) and
  (max-width: 1023px)` (HEAD:578), but the module used `min-width: 1024px` — this dropped the compact sizing from
  phone-landscape and applied it to desktop/tablet. Restored `max-width: 1023px`.
- **p1 — spectator self panel side**: the direct `PlayerIdentityBlock` branch in OnlinePlayerPanel hardcoded
  `side="left"`, but in spectator mode `seat="self"` uses that branch while its PlayerPanelShell is right-sided —
  the self avatar/shield/identity lost right-side mirroring. Changed to
  `side={seat === "opponent" ? "left" : "right"}`.
- **p2 — pass-2 metaFlag box-shadow dropped**: the migrated `.metaFlag` omitted
  `box-shadow: 0 0.08rem 0.2rem rgba(0,0,0,0.38)` (HEAD:1035-1041), flattening the state flag. Restored.
- Re-ran lint, `tsc -b`, `git diff --check`, fresh `npm run build` (`✓ built in 2.34s`). Fresh built-CSS asserts on
  useAutoRoll-DcXOJB_k (module hash now `1lg9p`): compact rules under `(width<=1023px)`; metaFlag box-shadow present;
  zero global identity leftovers.

### C6 — PlayerPanelShell CSS Module slice

- Created `PlayerPanelShell.module.css`; rewrote `PlayerPanelShell.tsx` to hashed locals. All 12 panel classes
  confirmed exclusive to this component (panel, card, cardGlow, top, statList, statsArt, panelBottom, compactPanel,
  compactTop, compactStatList, isTurn, + side variants).
- **Side-mirroring via existing `side` prop**: the aside already receives `side`, so `.left`/`.right` variant classes
  replace the `.game-player-panel--left/--right` parent-scoped selectors. Compounds (`.compactPanel.left`,
  `.panel.isTurn .card`, `.right.compactPanel .compactTop`) and descendants (`.left .card`, `.right .top`,
  `.left .statsArt`, `.left .card::before`) preserve original specificity (0,2,0 / 0,3,0).
- **Tailwind decomposed**: compact aside `justify-self-end/start` → `.justifyEnd`/`.justifyStart`; bottom-slot wrapper
  `flex flex-col gap-2 w-full` + `items-start/end` → `.bottomSlot` + `.bottomSlotStart`/`.bottomSlotEnd` (align prop
  mapped by value).
- **Cascade preserved verbatim**: pass-1 (base + compact) → 1023-media compact → pass-2 → pass-3 → pass-4 → pass-5 →
  620-media statList. `.panel`/`.top`/`.card`/`.card::before`/`.statList` resolution verified across passes in built
  CSS. Comments moved with their rules (is-turn glow, panel-bottom, pass-2 card frame, pass-5 painted box, 620
  countdown pill).
- index.css purge (text-anchored, assert-once): 1,083 → 730 lines (−353). `.game-side-slot`/`.game-actions-layer`/
  `.game-actions-inner`/`.game-board-column`/`.game-center-layer` untouched (C7 scope). Braces 98/98.
- Verification: lint, `tsc -b`, `git diff --check`, `npm run build` (`✓ built in 2.40s`). Built-CSS asserts on
  useAutoRoll-7Gdu596U (module hash `ce9ws`): zero global panel leftovers; all 12 locals emitted; side compounds/
  descendants present; media blocks (1023/620) present. **Accepted minifier dead-code elimination**: pass-3/pass-4
  `.statList` (`top:38.6%/36.6%;bottom:11.8%`) are fully overridden by pass-5 (`top:36.9%;bottom:14.5%`, same
  selector, later source) — dropped by lightningcss, identical rendered result to the original build. Browser/manual
  visual checks remain pending.

### C6 review fixes (reviewer agent)

- **p1 — fresh verification re-run on final tree**: lint, `tsc -b`, `git diff --check`, `npm run build`
  (`✓ built in 2.34s`) all pass. Fresh built-CSS asserts on useAutoRoll-7Gdu596U (module hash `ce9ws`): zero global
  panel leftovers; `panel.isTurn .card`, `left .card`, `right .top`, `compactPanel.left`,
  `right.compactPanel .compactTop`, `left .card:before`, `bottomSlot`, `justifyEnd` present; 1023/620 media blocks
  present; statList cascade confirms pass-5 wins (pass-3/4 dead-dropped, identical to original build).
- **p2 — diff-check coverage of untracked module**: the worktree index is read-only (`git add -N` fails), so used
  `git diff --no-index --check /dev/null PlayerPanelShell.module.css` — no whitespace errors (exit 1 is only the
  expected "files differ").
- Reviewer confirmed no code regression: all 49 migrated rules match HEAD after the selector mapping; side
  specificity/placement and Tailwind decomposition correct; pass-3/pass-4 statList genuinely dead (not a parity issue).

### C7 — BoardLayout CSS Module slice

- Created `BoardLayout.module.css`; rewrote `BoardLayout.tsx` to hashed locals. All 16 layout classes confirmed
  exclusive to this component (screen, backgroundImage, backgroundTone, content, stage, mobilePlayers, sideSlot,
  sideSlotLeft, sideSlotRight, boardColumn, boardStage, boardShell, actionsLayer, actionsInner, centerLayer,
  centerInner).
- **Side-slot mirroring via variant classes**: `game-side-slot--left/--right` → `sideSlotLeft`/`sideSlotRight`
  (applied alongside `sideSlot`).
- **Cascade preserved verbatim**: pass-1 (Gameplay v2) → 1024/1500/760/1023 media → pass-2 (asset-led) → 1.55 media
  → pass-3 (calibration) → max-1.95 media → min-1.95 media → pass-4 (side calibration) → min-1.95 media → pass-5
  (precision) → min-1.95 media → 620 media. `.boardColumn`/`.sideSlot`/`.actionsLayer`/`.actionsInner` resolution
  verified across passes in built CSS. Grouped rules preserved (`.actionsInner,.centerInner`,
  `.boardShell:before/:after,.boardStage:before`, `.boardShell>div:first-child,.boardShell canvas`).
- **Containing-block transform preserved**: `.boardColumn { transform: translateZ(0) }` (and the phone
  `translateX(-50%)`) kept — this is what anchors ActionButtons' `.primary` position:fixed to the board's right-middle
  (the old `.game-controls-primary` note; the class was since renamed to `.primary` in ActionButtons.module.css).
- index.css purge (text-anchored): 730 → 18 lines (Tailwind directives + html/body/#root base only). Braces 1/1.
- Verification: lint, `tsc -b`, `git diff --check`, `npm run build` (`✓ built in 2.32s`). Built-CSS asserts on
  useAutoRoll-BYCKhWny (module hash `3huox`): zero global layout leftovers; all 16 locals emitted; cascade orders +
  media interleave (1024/1500/760/1023/1.55/1.95/620) verified; grouped rules + transforms present. Browser/manual
  visual checks remain pending.

### C7 review fixes (reviewer agent)

- **p1 — fresh verification re-run on final tree**: lint, `tsc -b`, `git diff --check`, `npm run build`
  (`✓ built in 2.41s`) all pass. Fresh built-CSS asserts on useAutoRoll-FfLXRiMP (module hash `1jgdu`): zero global
  layout leftovers; grouped rules (boardShell:before/after/boardStage:before, boardShell>div:first-child/canvas,
  actionsInner/centerInner pointer-events:auto) present; `boardColumn` translateZ(0) + translate(-50%) present;
  actionsLayer z-index:260; sideSlot aspect-ratio 174/252; all media blocks (1024/1500/760/1023/1.55/1.95/620)
  present (620 minified to `height<=620px`).
- **p2 — restored `::before`/`::after`** in BoardLayout.module.css (was single-colon `:before`/`:after`) for verbatim
  parity with HEAD. Rebuilt; minifier normalizes to single-colon in output (behaviorally identical).
- Reviewer confirmed no code regression: TSX structure + all 16 local mappings, side-slot variants, grouped rules,
  translateZ(0) + translateX(-50%), clean index.css, preserved media/rule order, no scope creep.

### C8 — Overlay Tailwind decomposition

- Decomposed Tailwind utilities out of the 3 live board-overlay components into co-located modules:
  `EndOfGameModal.module.css`, `CubeOfferDecision.module.css`, `NavigationLoaderOverlay.module.css`. TSX rewritten
  to module locals only (zero Tailwind in className).
- **Deleted `DoublingCube.tsx`** — dead code (not imported anywhere; user approved removal). No references remain;
  its Tailwind classes (`w-[8%]`/`sm:w-[7%]`, `animate-pulse`, `ring-2`, etc.) are gone from the build.
- **Parity with current rendering** (values extracted from the built Tailwind CSS):
  - `capitalize` wins over `uppercase` on EndOfGameModal titleSmall (built order `.uppercase` < `.capitalize`) →
    `text-transform: capitalize`.
  - hover/active preserved: `:hover { filter: brightness(1.1) }`, `:active { transform: scale(0.95) }`.
  - Colors hardcoded from Tailwind palette (amber/stone/violet/board-felt) incl. opacity modifiers
    (`bg-black/65` → `rgba(0,0,0,0.65)`, `text-amber-900/80` → `rgba(120,53,15,0.8)`); shadows, gradients,
    border widths, spacing, font sizes/weights, letter-spacing, z-index, max-width, full `transition` semantics.
- **composes**: `fontDisplay` + `tabularNums` composed from `shared.module.css` (first declaration, `from` clause);
  no duplicated font-family/tabular-nums.
- Verification: lint, `tsc -b`, `git diff --check`, `npm run build` (`✓ built in 2.42s`) all pass. Built-CSS asserts:
  EndOfGameModal locals + hover/active + shared fontDisplay in the HotSeat chunk (lazy-loaded); CubeOfferDecision
  locals + hover/active in the main chunk; NavigationLoaderOverlay `z-index:9999` in the entry chunk; DoublingCube
  absent. Browser/manual visual checks remain pending.

### C8 review (reviewer agent)

- Reviewer confirmed (static): faithful Tailwind→CSS translation incl. palette opacity values, gradients, shadows,
  spacing, full transition semantics, `titleSmall` capitalization, all six hover/active rules; composes correct;
  DoublingCube deletion clean; no scope creep; lint + diff-check pass.
- p1 (fresh build not independently verifiable in read-only review) resolved: re-ran `tsc -b` (exit 0) and
  `npm run build` (`✓ built in 2.42s`) on the final tree, plus fresh built-CSS asserts across the HotSeat / main /
  entry chunks confirming module locals, composed classes, hover/active selectors, and DoublingCube absence.
