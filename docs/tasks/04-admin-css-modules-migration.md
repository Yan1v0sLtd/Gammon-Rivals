# Task: Admin CSS Modules Migration

> Status: pending · Last verified: 2026-08-10 · Owner: developer

## Purpose

Migrate `apps/admin` from Tailwind utility classes to co-located CSS Modules,
matching the conventions already established in `apps/game`. This is the admin
half of plan step 7 (admin and shared-package conversion) and step 8 (Tailwind
config and dependency removal) in
`docs/archive/css-modules-migration-state.md`.

The admin app starts from a different position than the game app did:

- `apps/admin/src/index.css` is only 17 lines — `@config`/`@tailwind`
  directives plus document base styles. There is **no global CSS monolith** to
  migrate.
- The real work is converting ~892 Tailwind utility `className` strings across
  40 TSX files into co-located CSS Modules.
- Admin has no `styles/` dir and no `shared.module.css` yet, and its
  `vite.config.ts` lacks the `css.modules.localsConvention: "camelCaseOnly"`
  setting the game added.
- `tailwind.admin.config.js` also scans `packages/board-preview` and
  `packages/board-renderer`; both have minimal Tailwind (one small file each)
  and must be cleared before Tailwind removal.

## Conventions (from `.claude/skills/css-modules/SKILL.md`)

- Co-located `<Component>.module.css` with descriptive camelCase locals.
- The module is the single source of truth; `className` holds only `styles.x`
  plus module-local dynamic classes. No Tailwind utilities remain.
- Name every descendant element with its own descriptive class; never reach
  into utilities with `:global()`.
- Repeated values live in `apps/admin/src/styles/shared.module.css` and are
  composed via `composes:` (first declaration, `from` clause). Never duplicate.
- Component-owned keyframes stay in the owning module; shared keyframes go in a
  shared keyframes file.
- `composes` cannot be used inside `@media` or on pseudo-selectors.
- No CSS custom properties as design tokens — use declared classes + `composes`.

## Terms

- **CSS Module** — a `.module.css` file whose class names are hashed at build
  time and scoped to the importing component.
- **`composes:`** — a CSS Modules feature that reuses a declared class's rules
  inside another rule.
- **Shared token** — a repeated value (button reset, field chrome, card chrome,
  text color) declared once in `shared.module.css` and composed into consumers.

## Steps

### A0 — Setup and inventory

- Add `css.modules.localsConvention: "camelCaseOnly"` to
  `apps/admin/vite.config.ts`, mirroring `apps/game/vite.config.ts`.
- Create `apps/admin/src/styles/shared.module.css` for the repeated admin
  tokens (button reset, field chrome, card chrome, text colors).
- Inventory all 40 TSX files with Tailwind utilities; classify each rule as
  shared vs component-owned.

### A1 — Shared component extraction (foundation)

Convert the shared UI primitives first, since every feature composes them:

- `PrimaryButton`, `SecondaryButton`, `DangerButton`, `StatusPill`, `Field`,
  `TextArea`, `Toggle`, `EmptyState`, `ConfigTable`, `useConfirm`,
  `ImageField`, `BoardTuningField`, `FeltCornersField`, `BearOffTraysField`.

This establishes the shared tokens that feature files will `composes:`.

### A2 — Feature slices (largest first)

Convert feature files in conservative slices, biggest first:

- `UsersAdmin` (104 classNames), `TemplatesEditor` (86),
  `BoardThemesAdmin` (80), `LevelCurveProposal` (67),
  `HourlyWheelAdmin` (64), `RTPAnalyticsAdmin` (56), `ShopAdmin` (47),
  `SimulatorTab` (47), then the remaining smaller features.

Each slice: co-located module, decompose Tailwind, compose shared styles,
remove utilities from `className`.

### A3 — Shell and remaining features

- `Admin.tsx`, `App.tsx`, `AdminAuthCallback`, `AdminAuthGate`,
  `AdminAccessAdmin`, and the small remaining feature files.

### A4 — Tailwind removal (admin + packages)

- Clear the two package files: `BoardPreview.tsx` and `BoardCanvas.tsx`.
- Remove `@config` and `@tailwind` directives from `apps/admin/src/index.css`
  (keep the document base styles).
- Delete `tailwind.admin.config.js` and `tailwind.config.js`.
- Strip Tailwind and autoprefixer from `postcss.config.js`.
- Remove `tailwindcss`, `autoprefixer`, and `postcss` from `package.json` and
  update the lockfile.

### A5 — Verification

- `npm run lint`
- `npm exec -- tsc -b apps/admin/tsconfig.json tsconfig.node.json`
- `npm run build:all`
- `git diff --check`
- Manual visual checks of the admin UI.

## Verification

- Zero Tailwind utilities remain in `apps/admin/src/**/*.{ts,tsx}`,
  `packages/board-preview/src/**/*.{ts,tsx}`, and
  `packages/board-renderer/src/**/*.{ts,tsx}`.
- No `@tailwind`/`@config` directives, Tailwind configs, or Tailwind/PostCSS
  dependencies remain.
- `npm run lint`, `tsc -b`, `npm run build:all`, and `git diff --check` pass.
- Admin UI renders without visual regressions.

## Related documents

- `docs/archive/css-modules-migration-state.md` — the game migration tracker;
  plan steps 7 and 8 cover this work.
- `.claude/skills/css-modules/SKILL.md` — the styling conventions to follow.
- `apps/game/src/styles/shared.module.css` — reference for the shared-token
  pattern.
