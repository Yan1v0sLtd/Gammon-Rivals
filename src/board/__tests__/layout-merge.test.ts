import { describe, expect, it } from 'vitest';
import { computeLayout, pointCoords } from '../coordinates';
import { computeHitRects } from '../hit-areas';
import { layoutFromMetadata } from '../theme/remote';
import { premiumTheme } from '../theme/premium';
import { BAR } from '../../engine/types';
import type { Json } from '../../types/database';

/**
 * Pins the layout-merge semantics that BOTH gameplay (remote.ts
 * themeFromBoardConfig) and the BO live preview (BoardPreview) rely on:
 *
 *   { ...premiumTheme.layout, ...layoutFromMetadata(metadata) }
 *
 * layoutFromMetadata must emit EVERY known key — value or explicit
 * undefined — so the spread ERASES the premium placeholder's tilted-era
 * per-point calibration (topPointCenterXRatios, bottomPointYRatio, …)
 * for keys a board's metadata doesn't set. If that ever regresses to a
 * pass-through parse (the BO preview's old local parser), pointCoords
 * gives the surviving premium arrays absolute precedence and the felt
 * corners stop driving positions — the "dragging the dots does nothing"
 * bug.
 */
function mergedLayout(metadata: Json) {
  return { ...premiumTheme.layout, ...layoutFromMetadata(metadata) };
}

// A board configured ONLY via the BO felt-corner dots (perfect rectangle,
// so the bilinear tilt path stays disengaged and coords are exact).
const cornersOnly = (leftX: number): Json => ({
  layout: {
    feltInnerTopLeftRatio: [leftX, 0.053],
    feltInnerTopRightRatio: [0.857, 0.053],
    feltInnerBottomLeftRatio: [leftX, 0.948],
    feltInnerBottomRightRatio: [0.857, 0.948],
  },
});

const ART_W = 1448;
const ART_H = 1086;

describe('board layout merge (BO preview ≡ gameplay)', () => {
  it('erases the premium tilted-era calibration for keys the metadata does not set', () => {
    const merged = mergedLayout(cornersOnly(0.145));
    expect(merged.topPointCenterXRatios).toBeUndefined();
    expect(merged.bottomPointCenterXRatios).toBeUndefined();
    expect(merged.topPointTipXRatios).toBeUndefined();
    expect(merged.topPointYRatio).toBeUndefined();
    expect(merged.bottomPointYRatio).toBeUndefined();
    expect(merged.topPlayLeftRatio).toBeUndefined();
  });

  it('moves the points when the felt corners move', () => {
    const at = (leftX: number) =>
      pointCoords(computeLayout(ART_W, ART_H, mergedLayout(cornersOnly(leftX))), 12);
    // Point 12 = bottom-left — its center must track the left felt edge.
    expect(at(0.3).x).toBeGreaterThan(at(0.145).x);
  });

  it('anchors the point rows to the felt top/bottom edges', () => {
    const layout = computeLayout(ART_W, ART_H, mergedLayout(cornersOnly(0.145)));
    expect(layout.topPointY).toBe(Math.round(ART_H * 0.053));
    expect(layout.bottomPointY).toBe(Math.round(ART_H * 0.948));
    // And the per-point premium arrays must not survive into the computed
    // layout, or pointCoords would use them instead of the felt geometry.
    expect(layout.topPointCenterXs).toBeNull();
    expect(layout.bottomPointCenterXs).toBeNull();
  });
});

/**
 * PER-HALF QUADS — the art-agnostic model. Each half is configured by its
 * own four corners; the bar is the MEASURED gap between the two quads and
 * each half divides its own width into 6 points. Deliberately unequal +
 * vertically offset halves, to pin that nothing assumes symmetry.
 *
 * Geometry at 1000×750:
 *   left  half: [0.10,0.06] → [0.44,0.95]  ⇒ flat 100..440, pw 56.67, top 45, bottom 713
 *   right half: [0.56,0.08] → [0.88,0.93]  ⇒ flat 560..880, pw 53.33, top 60, bottom 698
 *   bar = gap 440..560 (width 120)
 */
const HALVES_W = 1000;
const HALVES_H = 750;

const halvesMeta = (): Json => ({
  layout: {
    feltLeftHalfTopLeftRatio: [0.1, 0.06],
    feltLeftHalfBottomRightRatio: [0.44, 0.95],
    feltRightHalfTopLeftRatio: [0.56, 0.08],
    feltRightHalfBottomRightRatio: [0.88, 0.93],
  },
});

describe('per-half felt quads', () => {
  it('parses the half keys through the shared gameplay/preview parser', () => {
    const merged = mergedLayout(halvesMeta());
    expect(merged.feltLeftHalfTopLeftRatio).toEqual([0.1, 0.06]);
    expect(merged.feltRightHalfBottomRightRatio).toEqual([0.88, 0.93]);
    // Unset half keys are explicitly undefined (same erasure contract).
    expect(merged.feltLeftHalfTopRightRatio).toBeUndefined();
  });

  it('measures the bar as the gap between the two quads', () => {
    const layout = computeLayout(HALVES_W, HALVES_H, mergedLayout(halvesMeta()));
    expect(layout.barX).toBeCloseTo(440, 5);
    expect(layout.barWidth).toBeCloseTo(120, 5);
    // Radius-driving point width is the NARROWER half's (320/6).
    expect(layout.pointWidth).toBeCloseTo(320 / 6, 5);
    expect(layout.leftHalf?.pointWidth).toBeCloseTo(340 / 6, 5);
  });

  it('positions each half’s points inside its own quad — never on the bar', () => {
    const layout = computeLayout(HALVES_W, HALVES_H, mergedLayout(halvesMeta()));
    for (let idx = 0; idx < 24; idx++) {
      const pos = pointCoords(layout, idx);
      const leftHalfPoint = pos.column < 6;
      if (leftHalfPoint) {
        expect(pos.x).toBeGreaterThan(100);
        expect(pos.x).toBeLessThan(440); // never on/past the bar
      } else {
        expect(pos.x).toBeGreaterThan(560); // never on/past the bar
        expect(pos.x).toBeLessThan(880);
      }
    }
    // Exact first columns: left col0 = 100 + 0.5·(340/6); right col6 = 560 + 0.5·(320/6).
    expect(pointCoords(layout, 11).x).toBeCloseTo(100 + 0.5 * (340 / 6), 5);
    expect(pointCoords(layout, 5).x).toBeCloseTo(560 + 0.5 * (320 / 6), 5);
  });

  it('anchors each half’s rows to ITS OWN felt edges (vertical offset respected)', () => {
    const layout = computeLayout(HALVES_W, HALVES_H, mergedLayout(halvesMeta()));
    expect(pointCoords(layout, 11).y).toBe(45); // top row, left half (0.06·750)
    expect(pointCoords(layout, 5).y).toBe(60); // top row, right half (0.08·750)
    expect(pointCoords(layout, 12).y).toBe(713); // bottom row, left half (0.95·750)
    expect(pointCoords(layout, 18).y).toBe(698); // bottom row, right half (0.93·750)
  });

  it('keeps the click areas off the painted bar', () => {
    const layout = computeLayout(HALVES_W, HALVES_H, mergedLayout(halvesMeta()));
    const rects = computeHitRects(layout);
    const at = (target: number) => rects.find((r) => r.target === target)!;
    expect(at(17).right).toBeLessThanOrEqual(440); // bottom col 5 stops at the bar
    expect(at(18).left).toBeGreaterThanOrEqual(560 - 1e-6); // bottom col 6 starts after it
    const bar = rects.find((r) => r.target === BAR)!;
    expect(bar.left).toBeCloseTo(440, 5);
    expect(bar.right).toBeCloseTo(560, 5);
  });

  it('derives the bear-off trays from the halves’ combined extents', () => {
    const layout = computeLayout(HALVES_W, HALVES_H, mergedLayout(halvesMeta()));
    // Right felt edge 880, rail gap 120 ⇒ tray X at 880 + 120·0.5.
    expect(layout.blackOffTrayX).toBeCloseTo(940, 5);
    // Vertical extent 45..712.5 (felt height 667.5), margin 6%.
    expect(layout.blackOffTrayTop).toBeCloseTo(45 + 667.5 * 0.06, 3);
    expect(layout.whiteOffTrayTop).toBeCloseTo((45 + 712.5) / 2 + (667.5 * 0.22) / 2, 3);
  });
});
