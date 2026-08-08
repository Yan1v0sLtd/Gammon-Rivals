# Pixi Usage and Optimization

## How Pixi is used

Only three files import it:

- `src/board/BoardCanvas.tsx`
  - Creates and resizes `Application`.
  - Owns the canvas lifecycle.
- `src/board/theme/loader.ts`
  - Loads theme images with `Assets` and `Texture`.
- `src/board/pixi/BoardRenderer.ts`
  - Uses `Container`, `Graphics`, `FillGradient`, `Sprite`, and `TilingSprite`.
  - Draws the board, checkers, highlights, hit areas, and animations.

The admin uses the same renderer through `packages/board-preview/src/BoardPreview.tsx`.

We do not use Pixi text, mesh, particles, accessibility, or filters directly.

## Current bundle impact

- Full Pixi chunk: **518 kB minified / 148 kB gzip**.
- It is not part of the initial game HTML preload.
- It loads when a route containing `BoardCanvas` loads.
- Admin also loads it through the board preview.

The 518 kB warning is less serious than it looks, but the first game still downloads 148 kB.

## Recommended optimizations

### 1. Optimize rendering first

`BoardRenderer.drawScene()` currently destroys and recreates the whole Pixi scene on every update and animation frame.

Split it into persistent layers:

- Static board/background layer.
- Checker layer.
- Selection/hit-area layer.
- Animation layer.

Only redraw the changed layer. This should reduce allocations and mobile GPU/CPU work without changing the engine or visuals.

### 2. Lazy-load the admin preview

The admin statically imports `BoardPreview`, which imports `BoardCanvas`.

Load the preview only when the Board Themes section opens. This avoids downloading Pixi for admins working on users, economy, missions, or other sections.

### 3. Remove theme `HEAD` requests

`src/board/theme/loader.ts` sends a `HEAD` request before every `Assets.load()` request.

Use `Assets.load()` directly and handle failure. This removes one network round trip per theme asset.

### 4. Custom Pixi build

A custom build could include only:

- Browser environment.
- WebGL renderer.
- Application.
- Events.
- Graphics.
- Sprites and tiling sprites.
- Image textures/assets.

It could exclude text, accessibility, mesh, filters, and unused renderers. However, Pixi 8 exposes most classes through its root package, while selective modules rely on internal paths and registration side effects. This needs a prototype and visual/browser testing before adoption.

### 5. Canvas 2D replacement

The board only uses 2D shapes, images, pointer regions, and `requestAnimationFrame` animations. A custom Canvas 2D renderer could remove Pixi entirely.

That offers the largest bundle saving, but it is also the highest-risk option because every theme, animation, highlight, hit area, and admin preview must remain visually identical.

## Suggested order

1. Persistent renderer layers.
2. Lazy admin preview.
3. Remove `HEAD` requests.
4. Benchmark a selective Pixi build.
5. Consider Canvas 2D only if Pixi remains a real loading problem.

Keep the full Pixi package for now. Its transfer size is 148 kB and it is already route-lazy; runtime scene rebuilding is the more likely mobile performance problem.
