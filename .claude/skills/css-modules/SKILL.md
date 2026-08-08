---
name: css-modules
description: Use when adding, changing, or reviewing styling in apps/game/src — CSS Modules, className strings, index.css, keyframes, shared styles, or any Tailwind utilities. Also use when migrating global CSS to co-located CSS Modules or decomposing Tailwind utilities out of className.
---

# CSS Modules styling rules (player app)

Authoritative and self-contained conventions for styling in `apps/game/src`. Everything needed to write correct styling
is in this file — do not copy patterns from nearby files, and do not treat an existing file as the spec. If a file in
the repo disagrees with this document, this document wins and the file is a migration leftover.

## What to do, in order

1. **Classify the style** with the ownership table below. This decides the file you write, before you write anything.
2. **Co-locate**: create `<Component>.module.css` next to the component. Add to an existing module rather than inventing
   a parallel one.
3. **Name every descendant element** with its own descriptive camelCase class and style it directly. Never reach into
   utilities with `:global()`.
4. **Reuse before you repeat**: if a value is already declared in
   `styles/shared.module.css`, `composes` it. Never duplicate a repeated value.
5. **Remove Tailwind** from `className` — the module is the single source of truth; `className` holds only `styles.x`
   plus module-local dynamic classes.
6. **Run the verification block** at the bottom and fix everything it reports.

## Where a style belongs

| Style                                                                 | Owner                                                |
|-----------------------------------------------------------------------|------------------------------------------------------|
| A component's own look                                                | Co-located `<Component>.module.css`                  |
| Repeated value (font, color, radius, shadow)                          | `styles/shared.module.css`, composed via `composes:` |
| Keyframe used by one component                                        | That component's module                              |
| Keyframe used by several components                                   | `apps/game/src/keyframes.css`                        |
| True global contract (body, `data-fullscreen-modal`)                  | `apps/game/src/index.css`                            |
| Component-scoped dynamic value (`--lobby-u`, `--tone-*`, `--wheel-d`) | CSS custom property on the owning element            |

Rule of thumb: if you are about to repeat a value a second time, stop — declare it once in `shared.module.css` and
`composes` it. If you are about to use a CSS custom property as a design token, stop — use a declared class +
`composes`.

## Core principles

1. **The engine is pure TS and the source of truth; the UI is a view of board state.** Styling is UI. Never put rules
   logic in CSS, and never put styling decisions in the engine.
2. **Co-located CSS Modules** with descriptive camelCase locals, plus a small set of true global styles. No Tailwind.
3. **The module is the single source of truth.** `className` holds only
   `styles.x` plus module-local dynamic classes — no Tailwind utilities, no inline style for static values.
4. **Repeated styles become shared classes composed via `composes:`** — never duplicated.
5. **No CSS custom properties as design tokens.** Use declared styles and composition instead.

## CSS Modules

- Local class names are camelCase: `.actionTitle`, `.offerCard`, `.namePillWrap`.
- **Each descendant element gets its own descriptive class** and is styled directly. Do not write `:global(.relative)`,
  `:global(.min-w-0)`, or any selector that reaches into a utility class — that is "spaghetti". Give the element a name
  and style it.
- The module is the single source of truth: `className={`${styles.actionCard} ${toneClass[tone]}`}`. Dead or overridden
  Tailwind utilities are dropped, not kept.

## Shared styles via `composes`

Repeated values are declared once in `apps/game/src/styles/shared.module.css`
and composed into consumers:

```css
/* styles/shared.module.css */
.textWhite {
  color: #fff;
}
```

```css
/* LobbyActionCard.module.css */
.actionTitle {
  font-family: var(--font-display), sans-serif;
  composes: textWhite from "../styles/shared.module.css";
  display: block;
  font-weight: 900;
}
```

Rules:

- `composes` must be the **first** declaration in a rule (before any other property). Multiple `composes` lines are
  allowed, all at the top.
- `composes` **cannot** be used inside `@media` queries or on pseudo-selectors. For a shared value that must live inside
  a media query, apply the shared class in `className` instead, or accept the small duplication there.
- `index.css` is a global stylesheet (not a module) and cannot `composes`.

## CSS custom properties — allowed uses only

Custom properties are fine for **component-scoped dynamic values**, not as design tokens:

- Scaling units: `--lobby-u`, `--profile-u`, `--dice-*`.
- Tone variants: a variant class sets `--tone-from/via/to`; the base class consumes them in a `linear-gradient(...)`.
- Animation/geometry inputs: `--wheel-d`, `--dice-cube-size`.

Do **not** use a custom property for a shared design token (font, color, radius, shadow) — that is what `composes` is
for.

## Keyframes

- Component-owned keyframes stay in the owning module.
- Shared keyframes (multiple consumers) live in `apps/game/src/keyframes.css`, imported in `main.tsx` alongside
  `index.css`.
- When a module references a global keyframe, mark it `global(...)` so the module does not scope it (a real bug: an
  unscoped reference froze the animation).

## Tailwind removal

Tailwind is removed. When you see a Tailwind utility in `className`, decompose it into a module class:

- Breakpoints: `sm` = 640px, `lg` = 1024px, `xl` = 1280px, `2xl` = 1536px.
- Opacity modifiers: `text-white/78` = `rgba(255, 255, 255, 0.78)`.
- `font-display` = `font-family: var(--font-display), sans-serif;`.
- `!important` utilities (`!text-[1.35rem]`) become `font-size: 1.35rem !important`.

## Global styles

- Only true globals stay in `index.css` (e.g. the `data-fullscreen-modal` body contract,
  `lobby-bottom-nav-slot--hourly`).
- `index.css` is legacy and being migrated away; do not add new component styles to it.

## Verification

Run all of these and fix everything they report:

```bash
npm run lint
npm exec -- tsc -b apps/game/tsconfig.json tsconfig.node.json
git diff --check
npm run build
```

The full build passes (the two pre-existing `index.css` syntax errors — an unclosed comment and a stray `}` — were
fixed). If the build reports a CSS syntax error in `index.css`, it is a pre-existing latent bug, not your change.
