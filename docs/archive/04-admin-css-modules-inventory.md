# Admin CSS Modules Migration — Inventory (A0)

> Reference for the admin Tailwind → CSS Modules migration. Captures the
> Tailwind usage across `apps/admin/src` at the start of the work, the shared
> token catalog, and the per-file ownership classification. Use this to plan
> each slice (A1–A3) and to verify nothing is missed.
>
> Plan: `docs/tasks/04-admin-css-modules-migration.md`
> Conventions: `.claude/skills/css-modules/SKILL.md`

## Overview

- `apps/admin/src/index.css` is 17 lines: `@config`/`@tailwind` directives +
  document base styles. There is no global CSS monolith to migrate.
- 40 TSX files contain Tailwind utility `className` strings; 892 total
  `className` occurrences.
- 3 TSX files have no `className` (out of scope): `main.tsx`,
  `lib/AdminAuthProvider.tsx`, `components/StatusPill.tsx` (StatusPill uses a
  template literal with `enabled`/`disabled` branches — see below).
- `tailwind.admin.config.js` also scans `packages/board-preview` and
  `packages/board-renderer`; both have minimal Tailwind (one small file each)
  and must be cleared before Tailwind removal (A4).

## Setup changes made (A0)

- `apps/admin/vite.config.ts`: added
  `css.modules.localsConvention: "camelCaseOnly"` (mirrors `apps/game`).
- Created `apps/admin/src/styles/shared.module.css` (first pass):
  `fontDisplay`, `tabularNums`, `textWhite`, `fieldLabel`, `card`, `cardTitle`.

## A1 — Shared component extraction (complete)

All 14 shared UI primitives converted to co-located CSS Modules; zero Tailwind
utilities remain in `apps/admin/src/components/**/*.tsx`.

- New modules: `PrimaryButton`, `SecondaryButton`, `DangerButton`, `StatusPill`,
  `Field`, `TextArea`, `Toggle`, `EmptyState`, `ConfigTable`, `useConfirm`,
  `ImageField`, `BoardTuningField`, `FeltCornersField`, `BearOffTraysField`.
- `shared.module.css` grew: added `fieldInput` (base chrome; font-size/family
  left to consumers), `monoInput` (width left to consumers — `w-16` vs
  `w-full`), and `handle` (draggable felt-corner/tray handle).
- `composes:` used for `fieldLabel`, `fieldInput`, `monoInput`, `handle`.
- Dynamic classes mapped to module locals: `StatusPill` (`enabled`/`disabled`),
  `ConfigTable` (`clickable`), `useConfirm` (`danger`/`normal`),
  `ImageField` (`dragOver`/`dropZoneIdle`/`disabled`/`clickable`),
  `FeltCornersField` (`splitActive`/`splitIdle`, `dot`/`square`,
  `active`/`inactive`), `BearOffTraysField` (`active`/`inactive`).
- Responsive rules moved with owners: `sm:grid-cols-3` (BoardTuningField),
  `md:grid-cols-2` (FeltCornersField), `sm:grid-cols-2` (BearOffTraysField).
- Verified: lint, `tsc -b apps/admin`, `npm run build:admin`, `git diff --check`,
  `check:boundaries` all pass. Built admin CSS confirms module locals, composed
  shared classes (emitted once), and media queries present.

### A1 reviewer remediation

- **Line-heights restored**: added Tailwind line-heights for `text-xs` (1rem),
  `text-sm` (1.25rem), `text-lg` (1.75rem) to `fieldLabel`, `cardTitle`, and
  every text-sm/text-xs consumer (buttons, Field, TextArea, Toggle, EmptyState,
  ConfigTable, useConfirm, ImageField). Arbitrary `text-[Npx]` values need none.
- **`break-all`**: `overflow-wrap: anywhere` → `word-break: break-all`
  (ImageField).
- **Transitions**: added shared `.transition` token (full Tailwind property set,
  cubic-bezier(0.4,0,0.2,1), 150ms) composed into affected locals; `fieldInput`
  and `handle` carry it directly.
- **font-mono stack**: completed to `ui-monospace, SFMono-Regular, Menlo, Monaco,
  Consolas, "Liberation Mono", "Courier New", monospace` (shared `monoInput`,
  TextArea).
- **Felt/bear-off dedup**: extracted shared `preview`/`previewImg`/
  `previewPlaceholder`/`overlay`/`colorDot`/`numberInput`/`coordLabel` tokens;
  both coordinate editors compose them.
- **ConfigTable title**: now `composes: cardTitle` instead of duplicating.
- Re-verified: tsc, lint, `build:admin`, `git diff --check` all pass. Reviewer
  verdict: APPROVE_WITH_NITS → nit fixed.

## Shared token catalog

Repeated patterns that should become shared classes in
`apps/admin/src/styles/shared.module.css`, composed via `composes:`. Counts are
occurrences across all admin TSX files.

### Field / input chrome

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `fieldLabel` | `block text-xs font-bold uppercase tracking-[0.14em] text-white/40` | ~30 | Already in shared.module.css |
| `fieldInput` | `mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none` | ~25 | Has variants: some add `transition`, `placeholder:text-white/20`, `focus:border-amber-200/60`, `disabled:opacity-50`. Finalize in A1. |
| `monoInput` | `w-16 rounded border border-white/15 bg-black/30 px-1.5 py-1 text-right font-mono text-[11px] normal-case tracking-normal text-white/85 outline-none focus:border-amber-200/60` | 3 | Small numeric input (BearOffTraysField, FeltCornersField, BoardTuningField) |
| `ringInput` | `w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10` | ~20 | Ring-styled input, heavy in DailyMissions |
| `ringInputSm` | `rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10` | ~8 | Smaller ring input |

### Card chrome

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `card` | `rounded-xl border border-white/10 bg-white/[0.045] p-4` | ~40 | Already in shared.module.css |
| `cardSm` | `rounded-xl border border-white/10 bg-white/[0.045] p-3` | ~4 | Smaller card |
| `cardMuted` | `rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55` | ~8 | Card with muted body text |
| `cardTitle` | `text-lg font-black` | ~20 | Already in shared.module.css |
| `cardTitleSm` | `text-base font-black` | ~4 | Smaller title |
| `innerBox` | `rounded-lg border border-white/10 bg-black/20 p-2` | ~6 | Nested box |

### Buttons

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `primaryButton` | `rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-[#1b1202] shadow-lg shadow-amber-900/20 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50` | 1 | PrimaryButton.tsx — own module |
| `secondaryButton` | `rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/75 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50` | 1 | SecondaryButton.tsx — own module |
| `dangerButton` | `rounded-lg border border-rose-300/30 bg-rose-500/16 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50` | 1 | DangerButton.tsx — own module |
| `btnEmeraldSm` | `rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45` | ~4 | Small emerald action button (features) |
| `btnRoseSm` | `rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45` | ~4 | Small rose action button (features) |
| `btnWhiteSm` | `rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:bg-white/15` | ~4 | Small white action button (features) |
| `btnSolidEmerald` | `rounded bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50` | ~4 | Solid emerald (features) |
| `btnSolidAmber` | `rounded bg-amber-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-50` | ~2 | Solid amber (features) |

### Status / messaging

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `errorBanner` | `mb-4 rounded-lg border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100` | ~4 | Error banner |
| `roseBox` | `rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200` | ~8 | Rose message box (features) |
| `badgeEmerald` | `rounded bg-emerald-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200` | ~4 | Emerald badge |
| `badgeRose` | `rounded bg-rose-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200` | ~4 | Rose badge |
| `badgeSky` | `rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200` | ~4 | Sky badge |

### Table chrome

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `cell` | `px-3 py-2` | ~40 | Table cell padding |
| `cellLg` | `px-4 py-3` | ~30 | Larger cell padding |
| `cellRight` | `px-3 py-2 text-right` | ~20 | Right-aligned cell |
| `tableHead` | `bg-white/[0.04] text-[10px] uppercase tracking-[0.14em] text-white/45` | ~4 | Table header row |

### Layout

| Token | Tailwind source | Count | Notes |
|---|---|---|---|
| `twoCol` | `grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]` | ~8 | Two-column feature layout (28rem variant) |
| `twoColWide` | `grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]` | ~2 | 32rem variant |
| `twoColMid` | `grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]` | ~1 | 30rem variant |
| `twoColNarrow` | `grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]` | ~1 | 26rem variant |
| `grid2` | `mt-3 grid grid-cols-2 gap-3` | ~10 | Two-column grid |
| `grid3` | `mt-3 grid grid-cols-3 gap-2` | ~4 | Three-column grid |

### Text colors (opacity variants)

Repeated `text-white/<opacity>` shades. These are distinct shades, not a single
muted token; decide in A1 whether to keep as per-module values or add shared
classes. Counts: `/40` ~58, `/55` ~36, `/35` ~31, `/70` ~29, `/60` ~21,
`/50` ~19, `/45` ~18, `/80` ~7, `/85` ~6, `/65` ~4, `/75` ~2, `/30` ~5,
`/25` ~2.

### Other repeated utilities

- `font-mono` (~46), `tabular-nums` (~16), `font-display` (~4).
- `truncate` (~6), `break-all` (~4), `whitespace-pre-line` (~1).
- `accent-amber-300` checkbox (`h-4 w-4 accent-amber-300`, ~5).
- `disabled:opacity-50` / `disabled:opacity-45` / `disabled:opacity-40`
  (~40 combined).
- `hover:` variants are component-specific and stay in their owning module.

## Per-file inventory

Grouped by migration phase. Count = `className` occurrences.

### A1 — Shared components (foundation)

| File | Count | Notes |
|---|---|---|
| `components/PrimaryButton.tsx` | 1 | Single button class → own module |
| `components/SecondaryButton.tsx` | 1 | Single button class → own module |
| `components/DangerButton.tsx` | 1 | Single button class → own module |
| `components/StatusPill.tsx` | 0 | Template literal with `enabled`/`disabled` branches; needs module locals |
| `components/Field.tsx` | 1 | `fieldLabel` + `fieldInput` (picker variant) |
| `components/TextArea.tsx` | 2 | `fieldLabel` + `fieldInput` (mono) |
| `components/Toggle.tsx` | 2 | Row + checkbox |
| `components/EmptyState.tsx` | 1 | Single class |
| `components/ConfigTable.tsx` | 7 | Card + table chrome |
| `components/useConfirm.tsx` | 7 | Modal overlay + buttons |
| `components/ImageField.tsx` | 13 | Field + preview + buttons |
| `components/BoardTuningField.tsx` | 18 | Field + small inputs + grid |
| `components/FeltCornersField.tsx` | 17 | Field + small inputs + grid |
| `components/BearOffTraysField.tsx` | 13 | Field + small inputs + grid |

### A2 — Feature slices (largest first)

| File | Count |
|---|---|
| `features/Users/UsersAdmin.tsx` | 104 | ✅ done |
| `features/DailyMissions/TemplatesEditor.tsx` | 86 | ✅ done |
| `features/BoardThemes/BoardThemesAdmin.tsx` | 80 | ✅ done |
| `features/LevelSystem/LevelCurveProposal.tsx` | 67 | ✅ done |
| `features/HourlyWheel/HourlyWheelAdmin.tsx` | 64 | ✅ done |
| `features/RTPAnalytics/RTPAnalyticsAdmin.tsx` | 56 | ✅ done |
| `features/Shop/ShopAdmin.tsx` | 47 | ✅ done |
| `features/DailyMissions/SimulatorTab.tsx` | 47 | ✅ done |
| `features/DailyMissions/MissionTypesEditor.tsx` | 37 | ✅ done |
| `features/LevelSystem/LevelSystemAdmin.tsx` | 34 | ✅ done |
| `features/DailyMissions/ChestsEditor.tsx` | 21 | ✅ done |
| `features/Dashboard/DashboardAdmin.tsx` | 20 | ✅ done |
| `features/DailyMissions/RerollEditor.tsx` | 15 | ✅ done |
| `features/AdminAccess/AdminAccessAdmin.tsx` | 15 | ✅ done |
| `features/DailyMissions/MissionsAdminShared.tsx` | 13 | ✅ done |
| `features/DailyMissions/StreakEditor.tsx` | 6 | ✅ done |
| `features/DailyMissions/RefreshMissionsTool.tsx` | 6 | ✅ done |
| `features/DailyMissions/MissionsAdmin.tsx` | 2 | ✅ done |

### A3 — Shell and remaining features

| File | Count |
|---|---|
| `Admin.tsx` | 15 | ✅ done |
| `features/AdminAccess/AdminAuthGate.tsx` | 13 | ✅ done |
| `features/Difficulties/DifficultiesAdmin.tsx` | 12 | ✅ done |
| `features/LobbyFeatures/LobbyFeaturesAdmin.tsx` | 11 | ✅ done |
| `features/EconomyGrants/EconomyGrantsAdmin.tsx` | 11 | ✅ done |
| `features/Currencies/CurrenciesAdmin.tsx` | 11 | ✅ done |
| `features/DailyBonus/DailyBonusAdmin.tsx` | 7 | ✅ done |
| `AdminAuthCallback.tsx` | 5 | ✅ done |
| `App.tsx` | 2 | ✅ done |

### A4 — Package files (in admin Tailwind content glob)

| File | Count | Notes |
|---|---|---|
| `packages/board-preview/src/BoardPreview.tsx` | ~7 | ✅ done |
| `packages/board-renderer/src/BoardCanvas.tsx` | 1 | ✅ done |

## Classification notes

- **Shared tokens** (composed via `composes:`): field/input chrome, card chrome,
  small action buttons, badges, table cells, layout grids. These are the
  consolidation win — do not duplicate them per module.
- **Component-owned**: anything used by a single component (e.g. the three
  Button components, StatusPill branches, per-feature hover states, unique
  grids like `grid-cols-[5rem_5rem_minmax(0,1fr)_5rem_5rem_2rem]`).
- **True globals** (stay in `index.css`): the document base styles only. No
  component styles belong there.
- **Dynamic classes**: `StatusPill` (`enabled`/`disabled`), `ConfigTable`
  (`onRowClick` hover), and feature state branches map to module locals, not
  rebuilt hashed names.
- **`font-display`** maps to `font-family: var(--font-display), sans-serif`
  (already in shared.module.css as `fontDisplay`).
- **Opacity modifiers** (`text-white/40`, `bg-white/[0.045]`, etc.) become
  `rgba(...)` values in the module.
