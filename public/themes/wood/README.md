# Wood theme assets

Drop image files matching the names below into this folder. The renderer auto-detects them on next page load and replaces the procedural fallback with your art. Any missing file falls back gracefully — you can drop in just the ones you have.

| File | Purpose | Suggested size |
| ---- | ------- | -------------- |
| `frame.png` | Outer ornate frame, tiled across the whole canvas. | 256×256 seamless wood |
| `felt.png` | Playing surface tiled inside the frame. | 256×256 seamless |
| `rail.png` | Side rails (left + right). | 64×512 vertical seamless |
| `bar.png` | Central vertical bar. | 64×512 |
| `point-light.png` | One light triangle, stretched per point. Anchor: top-center, tip pointing down. | 128×384 |
| `point-dark.png` | One dark triangle. Same shape as point-light. | 128×384 |
| `hinge.png` | Brass hinge accent at top and bottom of the bar. | 96×24 |
| `checker-white.png` | Single white/cream checker disc with transparent corners. | 128×128 PNG with alpha |
| `checker-black.png` | Single dark checker disc. | 128×128 PNG with alpha |

Notes:
- All files are `*.png` and must support transparency where needed (especially checkers).
- Frame/felt/rail/bar are tiled (TilingSprite), so seamless textures look best.
- Triangles and checkers are scaled to fit the computed point/checker size — provide them at high resolution (~2× display size) for crispness on retina screens.
- To activate this theme, pass `theme={woodTheme}` to `<BoardCanvas>` in `HotSeat.tsx` (currently set to `defaultTheme`).
