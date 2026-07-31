import { BAR, OFF } from '../../engine/src/types';
import type { Player, Position } from '../../engine/src/types';
import { checkerCenter, pointCoords, type Layout } from './coordinates';

export interface HitRect {
  readonly target: Position;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Build the click target rectangles for the board. Extracted from
 * BoardRenderer so the math can be tested directly without spinning
 * up Pixi. The renderer iterates the result in order and adds Pixi
 * Graphics with these bounds. Later entries are drawn on top, so
 * order matters — bear-off trays and the bar appear LAST so a click
 * inside them wins over an adjacent point hit, but the bear-off
 * trays are scoped to the actual tray rectangles (not the full
 * right rail) so they don't hijack clicks on the rightmost points.
 */
export function computeHitRects(layout: Layout): HitRect[] {
  const {
    width,
    height,
    barX,
    barWidth,
    checkerRadius,
    blackOffTrayX,
    blackOffTrayTop,
    blackOffTrayHeight,
    whiteOffTrayX,
    whiteOffTrayTop,
    whiteOffTrayHeight,
  } = layout;

  const rects: HitRect[] = [];

  const addRow = (isBottom: boolean) => {
    const pointWidth = isBottom ? layout.bottomPointWidth : layout.topPointWidth;
    const xs: number[] = [];
    for (let c = 0; c < 12; c++) {
      const idx = isBottom ? 12 + c : 11 - c;
      xs.push(pointCoords(layout, idx).x);
    }
    const top = isBottom ? height / 2 : 0;
    const bottom = isBottom ? height : height / 2;
    const minHalf = Math.max(pointWidth, checkerRadius * 2) / 2;

    // Anchor the row's outer boundaries to the FIRST and LAST point's
    // visual centres rather than the axis-aligned rail edges. On
    // tilted-felt themes (marble-kingdom etc.) the visual centre of
    // c=0 bottom can sit at ~11% of width while the axis-aligned
    // railWidth is ~20% — using railWidth for `left` flips the rect
    // and the clamp can't always rescue it. Half the gap to the
    // next-inside point gives a sensible amount of slop without
    // colliding with the rails or off-trays (which sit further out).
    const rowLeftEdge = xs[0]! - Math.min(minHalf, (xs[1]! - xs[0]!) / 2);
    const rowRightEdge = xs[11]! + Math.min(minHalf, (xs[11]! - xs[10]!) / 2);

    for (let c = 0; c < 12; c++) {
      const idx = isBottom ? 12 + c : 11 - c;
      const center = xs[c]!;

      // Natural bounds — midpoints to the immediate neighbours, or
      // the row / bar edges at the row's extremes. These give a
      // partition of the row into per-point regions with NO
      // overlap.
      let natLeft: number;
      let natRight: number;
      if (c <= 5) {
        natLeft = c === 0 ? rowLeftEdge : (xs[c - 1]! + center) / 2;
        natRight = c === 5 ? barX : (center + xs[c + 1]!) / 2;
      } else {
        natLeft = c === 6 ? barX + barWidth : (xs[c - 1]! + center) / 2;
        natRight = c === 11 ? rowRightEdge : (center + xs[c + 1]!) / 2;
      }

      // The minHalf clamp tries to guarantee at least a checker-
      // radius of click area on each side of the centre. It used to
      // win unconditionally (Math.min for left, Math.max for right),
      // which on tilted themes pushed each rect PAST the midpoint
      // and into its neighbour's territory — adjacent points
      // overlapped by up to 10px and clicks landed on the wrong
      // index. Clamp the expansion so it never crosses the natural
      // midpoint: the row stays partitioned, every click in the row
      // routes to SOME point, and clicks near the centre of any
      // point go to that point.
      const desiredLeft = center - minHalf;
      const desiredRight = center + minHalf;
      const left = Math.max(natLeft, Math.min(desiredLeft, center));
      const right = Math.min(natRight, Math.max(desiredRight, center));

      rects.push({ target: idx, left, right, top, bottom });
    }
  };
  addRow(false);
  addRow(true);

  // Bar.
  rects.push({ target: BAR, left: barX, right: barX + barWidth, top: 0, bottom: height });

  // OFF trays — sized to the actual tray graphics published by the
  // theme so a click on the rightmost POINTS isn't hijacked by a
  // full-height right-rail OFF rectangle. Each tray gets a tiny
  // checker-radius padding so the visible edge of an off-tray
  // checker is still clickable.
  const trayPadding = Math.max(checkerRadius, 4);
  rects.push({
    target: OFF,
    left: blackOffTrayX - trayPadding,
    right: width,
    top: Math.max(0, blackOffTrayTop - trayPadding),
    bottom: blackOffTrayTop + blackOffTrayHeight + trayPadding,
  });
  rects.push({
    target: OFF,
    left: whiteOffTrayX - trayPadding,
    right: width,
    top: Math.max(0, whiteOffTrayTop - trayPadding),
    bottom: whiteOffTrayTop + whiteOffTrayHeight + trayPadding,
  });

  return rects;
}

/**
 * Resolve a screen-space click into a target Position by walking the
 * hit rectangles in REVERSE order (last added wins, matching Pixi's
 * z-order semantics). Returns null when no rect contains the click.
 */
export function hitTest(rects: readonly HitRect[], x: number, y: number): Position | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return r.target;
    }
  }
  return null;
}

/**
 * The visual anchor of the green destination ring for an empty
 * point. Mirrors BoardRenderer.destinationAnchor for the
 * "point with no checkers" case — the most common click target,
 * and the one the renderer uses to position the ring graphic.
 */
export function destinationAnchorForEmptyPoint(
  layout: Layout,
  player: Player,
  pos: number,
): { x: number; y: number } {
  const ppos = pointCoords(layout, pos);
  // stackIdx=0, count=1 for the first checker landing on an empty
  // point (or on top of an opponent's blot — in both cases the new
  // checker is at the base of the stack).
  void player;
  return checkerCenter(layout, ppos, 0, 1);
}
