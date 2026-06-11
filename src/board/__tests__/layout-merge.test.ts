import { describe, expect, it } from 'vitest';
import { computeLayout, pointCoords } from '../coordinates';
import { layoutFromMetadata } from '../theme/remote';
import { premiumTheme } from '../theme/premium';
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
