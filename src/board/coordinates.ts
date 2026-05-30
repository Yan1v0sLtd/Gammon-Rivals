import type { ThemeLayout } from './theme';

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly railWidth: number;
  readonly playLeft: number;
  readonly playWidth: number;
  readonly barX: number;
  readonly barWidth: number;
  readonly pointWidth: number;
  readonly topPointWidth: number;
  readonly bottomPointWidth: number;
  readonly topPlayLeft: number;
  readonly bottomPlayLeft: number;
  readonly topBarWidth: number;
  readonly bottomBarWidth: number;
  readonly topPointCenterXs: readonly number[] | null;
  readonly bottomPointCenterXs: readonly number[] | null;
  readonly topPointTipXs: readonly number[] | null;
  readonly bottomPointTipXs: readonly number[] | null;
  readonly topCheckerOffsetXs: readonly number[] | null;
  readonly bottomCheckerOffsetXs: readonly number[] | null;
  readonly pointHeight: number;
  readonly topPointHeight: number;
  readonly bottomPointHeight: number;
  readonly topPointY: number;
  readonly bottomPointY: number;
  readonly checkerRadius: number;
  readonly checkerScaleY: number;
  readonly checkerStackSpacing: number;
  readonly topCheckerStackSpacing: number;
  readonly bottomCheckerStackSpacing: number;
  readonly topCheckerPadding: number;
  readonly bottomCheckerPadding: number;
  readonly blackOffTrayX: number;
  readonly blackOffTrayTop: number;
  readonly blackOffTrayHeight: number;
  readonly whiteOffTrayX: number;
  readonly whiteOffTrayTop: number;
  readonly whiteOffTrayHeight: number;
  readonly offCheckerStackSpacing: number;
  readonly blackOffTrayTiltDeg: number;
  readonly whiteOffTrayTiltDeg: number;
  /** Four pixel corners of the painted felt rectangle. When the
   *  theme provides only TL + BR, TR and BL are auto-derived as
   *  axis-aligned. When the theme provides all four, the felt can
   *  be tilted in perspective and `feltTilted` is true. */
  readonly feltTL: readonly [number, number];
  readonly feltTR: readonly [number, number];
  readonly feltBL: readonly [number, number];
  readonly feltBR: readonly [number, number];
  readonly feltTilted: boolean;
  readonly feltDepthScaleRatio: number;
}

export function computeLayout(width: number, height: number, themeLayout?: ThemeLayout): Layout {
  const railWidth = Math.round(width * (themeLayout?.railWidthRatio ?? 0.07));
  // When the theme provides felt-corner ratios, derive the play area
  // (left edge, width, top/bottom Y) from those corners. Otherwise fall
  // back to the legacy railWidth-derived rectangle so existing themes
  // keep rendering identically.
  const feltTLRatio = themeLayout?.feltInnerTopLeftRatio;
  const feltBRRatio = themeLayout?.feltInnerBottomRightRatio;
  const feltTRRatio = themeLayout?.feltInnerTopRightRatio;
  const feltBLRatio = themeLayout?.feltInnerBottomLeftRatio;
  const feltL = feltTLRatio ? width * feltTLRatio[0] : railWidth;
  const feltT = feltTLRatio ? height * feltTLRatio[1] : 0;
  const feltR = feltBRRatio ? width * feltBRRatio[0] : width - railWidth;
  const feltB = feltBRRatio ? height * feltBRRatio[1] : height;
  // Top-right and bottom-left default to axis-aligned (so a 2-corner
  // theme behaves exactly like a rectangle).
  const feltTL: [number, number] = [feltL, feltT];
  const feltBR: [number, number] = [feltR, feltB];
  const feltTR: [number, number] = feltTRRatio
    ? [width * feltTRRatio[0], height * feltTRRatio[1]]
    : [feltR, feltT];
  const feltBL: [number, number] = feltBLRatio
    ? [width * feltBLRatio[0], height * feltBLRatio[1]]
    : [feltL, feltB];
  // Tilted when TR or BL deviates from the axis-aligned derivation.
  const tiltEps = 0.5; // px tolerance for "axis-aligned"
  const feltTilted =
    Math.abs(feltTR[0] - feltR) > tiltEps ||
    Math.abs(feltTR[1] - feltT) > tiltEps ||
    Math.abs(feltBL[0] - feltL) > tiltEps ||
    Math.abs(feltBL[1] - feltB) > tiltEps;
  const feltDepthScaleRatio = themeLayout?.feltDepthScaleRatio ?? 0;
  const playLeft = feltL;
  const playWidth = Math.max(1, feltR - feltL);
  const barWidth = Math.round(playWidth * (themeLayout?.barWidthRatio ?? 0.08));
  const pointWidth = (playWidth - barWidth) / 12;
  const barX = playLeft + 6 * pointWidth;
  const topPointWidth = themeLayout?.topPointWidthRatio
    ? width * themeLayout.topPointWidthRatio
    : pointWidth;
  const bottomPointWidth = themeLayout?.bottomPointWidthRatio
    ? width * themeLayout.bottomPointWidthRatio
    : pointWidth;
  const topPlayLeft = themeLayout?.topPlayLeftRatio ? width * themeLayout.topPlayLeftRatio : playLeft;
  const bottomPlayLeft = themeLayout?.bottomPlayLeftRatio
    ? width * themeLayout.bottomPlayLeftRatio
    : playLeft;
  const topBarWidth = themeLayout?.topBarWidthRatio ? width * themeLayout.topBarWidthRatio : barWidth;
  const bottomBarWidth = themeLayout?.bottomBarWidthRatio
    ? width * themeLayout.bottomBarWidthRatio
    : barWidth;
  const topPointCenterXs =
    themeLayout?.topPointCenterXRatios?.length === 12
      ? themeLayout.topPointCenterXRatios.map((ratio) => width * ratio)
      : null;
  const bottomPointCenterXs =
    themeLayout?.bottomPointCenterXRatios?.length === 12
      ? themeLayout.bottomPointCenterXRatios.map((ratio) => width * ratio)
      : null;
  const topPointTipXs =
    themeLayout?.topPointTipXRatios?.length === 12
      ? themeLayout.topPointTipXRatios.map((ratio) => width * ratio)
      : null;
  const bottomPointTipXs =
    themeLayout?.bottomPointTipXRatios?.length === 12
      ? themeLayout.bottomPointTipXRatios.map((ratio) => width * ratio)
      : null;
  const topCheckerOffsetXs =
    themeLayout?.topCheckerOffsetXRatios?.length === 12
      ? themeLayout.topCheckerOffsetXRatios.map((ratio) => width * ratio)
      : null;
  const bottomCheckerOffsetXs =
    themeLayout?.bottomCheckerOffsetXRatios?.length === 12
      ? themeLayout.bottomCheckerOffsetXRatios.map((ratio) => width * ratio)
      : null;
  // Point depth — shared default with per-row overrides so top and
  // bottom rows can be tuned independently in alignment mode.
  const sharedPointHeightRatio = themeLayout?.pointHeightRatio ?? 0.44;
  const topPointHeight = Math.round(
    height * (themeLayout?.topPointHeightRatio ?? sharedPointHeightRatio)
  );
  const bottomPointHeight = Math.round(
    height * (themeLayout?.bottomPointHeightRatio ?? sharedPointHeightRatio)
  );
  // Legacy single value kept for any callers that haven't switched to
  // the per-row pair yet.
  const pointHeight = Math.round(height * sharedPointHeightRatio);
  // Default the row Y anchors to the felt's top / bottom edges when
  // felt corners are provided. Per-row overrides (topPointYRatio /
  // bottomPointYRatio) still win when explicitly set.
  const topPointY = Math.round(
    themeLayout?.topPointYRatio !== undefined ? height * themeLayout.topPointYRatio : feltT
  );
  const bottomPointY = Math.round(
    themeLayout?.bottomPointYRatio !== undefined ? height * themeLayout.bottomPointYRatio : feltB
  );
  const checkerRadius = Math.floor(pointWidth * (themeLayout?.checkerRadiusRatio ?? 0.42));
  const checkerScaleY = themeLayout?.checkerScaleYRatio ?? 1;
  const sharedCheckerStackSpacing = themeLayout?.checkerStackSpacingRatio ?? 1;
  const topCheckerStackSpacing =
    themeLayout?.topCheckerStackSpacingRatio ?? sharedCheckerStackSpacing;
  const bottomCheckerStackSpacing =
    themeLayout?.bottomCheckerStackSpacingRatio ?? sharedCheckerStackSpacing;
  const checkerStackSpacing = sharedCheckerStackSpacing;
  const topCheckerPadding = themeLayout?.topCheckerPaddingRatio ?? 1;
  const bottomCheckerPadding = themeLayout?.bottomCheckerPaddingRatio ?? 1;
  // Bear-off trays. When the theme provides felt corners, DERIVE both
  // trays from the felt itself instead of absolute board fractions — so
  // each board's tray auto-tracks its own felt. Set the corners once (the
  // same dots that place the points) and the trays follow; there's no
  // per-board tray position to configure. The trays sit just outside the
  // right felt edge, spanning the felt vertically: black on the upper
  // half, white on the lower half, with a gap at the midline.
  //
  // Shared tuning knobs (global defaults; a board MAY override them in its
  // own metadata.layout for an oddly-framed board):
  //   offTrayInsetRatio  - tray centre across the right rail (0 = at the
  //                        felt edge, 1 = at the board edge). Default 0.5.
  //   offTrayMarginRatio - vertical inset from the felt top/bottom edges,
  //                        as a fraction of felt height. Default 0.06.
  //   offTrayMidGapRatio - gap between the two trays at the felt midline,
  //                        as a fraction of felt height. Default 0.22.
  // (Defaults reproduce the legacy 0.925 / 0.145 / 0.61 look, but anchored
  // to each board's felt rather than fixed to the image.)
  //
  // Corner-less themes — or a board that explicitly sets the absolute
  // *OffTray*Ratio keys — keep the legacy absolute behaviour unchanged.
  const offTrayInset = themeLayout?.offTrayInsetRatio ?? 0.5;
  const offTrayMargin = themeLayout?.offTrayMarginRatio ?? 0.06;
  const offTrayMidGap = themeLayout?.offTrayMidGapRatio ?? 0.22;
  const hasExplicitOffTray =
    themeLayout?.whiteOffTrayXRatio !== undefined ||
    themeLayout?.blackOffTrayXRatio !== undefined;
  let blackOffTrayX: number;
  let blackOffTrayTop: number;
  let blackOffTrayHeight: number;
  let whiteOffTrayX: number;
  let whiteOffTrayTop: number;
  let whiteOffTrayHeight: number;
  if ((feltTLRatio || feltBRRatio) && !hasExplicitOffTray) {
    const feltRightEdge = Math.max(feltTR[0], feltBR[0]);
    const feltTopEdge = Math.min(feltTL[1], feltTR[1]);
    const feltBottomEdge = Math.max(feltBL[1], feltBR[1]);
    const feltMid = (feltTopEdge + feltBottomEdge) / 2;
    const feltH = Math.max(1, feltBottomEdge - feltTopEdge);
    const railGap = Math.max(0, width - feltRightEdge);
    const trayX = feltRightEdge + railGap * offTrayInset;
    const margin = feltH * offTrayMargin;
    const halfGap = (feltH * offTrayMidGap) / 2;
    blackOffTrayX = trayX;
    blackOffTrayTop = feltTopEdge + margin;
    blackOffTrayHeight = Math.max(1, feltMid - halfGap - blackOffTrayTop);
    whiteOffTrayX = trayX;
    whiteOffTrayTop = feltMid + halfGap;
    whiteOffTrayHeight = Math.max(1, feltBottomEdge - margin - whiteOffTrayTop);
  } else {
    blackOffTrayX = width * (themeLayout?.blackOffTrayXRatio ?? 0.925);
    blackOffTrayTop = height * (themeLayout?.blackOffTrayTopRatio ?? 0.145);
    blackOffTrayHeight = height * (themeLayout?.blackOffTrayHeightRatio ?? 0.255);
    whiteOffTrayX = width * (themeLayout?.whiteOffTrayXRatio ?? 0.925);
    whiteOffTrayTop = height * (themeLayout?.whiteOffTrayTopRatio ?? 0.61);
    whiteOffTrayHeight = height * (themeLayout?.whiteOffTrayHeightRatio ?? 0.255);
  }
  const offCheckerStackSpacing = themeLayout?.offCheckerStackSpacingRatio ?? 0.56;
  const blackOffTrayTiltDeg = themeLayout?.blackOffTrayTiltDeg ?? 0;
  const whiteOffTrayTiltDeg = themeLayout?.whiteOffTrayTiltDeg ?? 0;
  return {
    width,
    height,
    railWidth,
    playLeft,
    playWidth,
    barX,
    barWidth,
    pointWidth,
    topPointWidth,
    bottomPointWidth,
    topPlayLeft,
    bottomPlayLeft,
    topBarWidth,
    bottomBarWidth,
    topPointCenterXs,
    bottomPointCenterXs,
    topPointTipXs,
    bottomPointTipXs,
    topCheckerOffsetXs,
    bottomCheckerOffsetXs,
    pointHeight,
    topPointHeight,
    bottomPointHeight,
    topPointY,
    bottomPointY,
    checkerRadius,
    checkerScaleY,
    checkerStackSpacing,
    topCheckerStackSpacing,
    bottomCheckerStackSpacing,
    topCheckerPadding,
    bottomCheckerPadding,
    blackOffTrayX,
    blackOffTrayTop,
    blackOffTrayHeight,
    whiteOffTrayX,
    whiteOffTrayTop,
    whiteOffTrayHeight,
    offCheckerStackSpacing,
    blackOffTrayTiltDeg,
    whiteOffTrayTiltDeg,
    feltTL,
    feltTR,
    feltBL,
    feltBR,
    feltTilted,
    feltDepthScaleRatio,
  };
}

/**
 * Map a flat-space (x, y) that was computed against the axis-aligned
 * bounding box [feltTL, feltBR] onto the four-corner felt quad. When
 * the felt isn't tilted (TR/BL match the AA derivation) this is the
 * identity transform, so legacy code paths keep producing the same
 * pixels. When the felt is tilted, the same (x, y) gets bilinearly
 * interpolated into the tilted quad — points and checker stacks
 * automatically follow the painted perspective.
 */
export function feltTransform(layout: Layout, x: number, y: number): { x: number; y: number } {
  if (!layout.feltTilted) return { x, y };
  const aaLeft = layout.feltTL[0];
  const aaTop = layout.feltTL[1];
  const aaWidth = layout.feltBR[0] - layout.feltTL[0];
  const aaHeight = layout.feltBR[1] - layout.feltTL[1];
  if (aaWidth <= 0 || aaHeight <= 0) return { x, y };
  const u = (x - aaLeft) / aaWidth;
  const v = (y - aaTop) / aaHeight;
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = (1 - u) * v;
  const d = u * v;
  const ax =
    layout.feltTL[0] * a + layout.feltTR[0] * b + layout.feltBL[0] * c + layout.feltBR[0] * d;
  const ay =
    layout.feltTL[1] * a + layout.feltTR[1] * b + layout.feltBL[1] * c + layout.feltBR[1] * d;
  return { x: ax, y: ay };
}

/** Depth scale at a flat-space Y: 1.0 at the felt mid-line, scaled
 *  up toward the felt's bottom edge and down toward the top edge by
 *  `feltDepthScaleRatio`. Identity (1) when the felt isn't tilted or
 *  no depth scale is configured. */
export function feltDepthScale(layout: Layout, yFlat: number): number {
  if (!layout.feltTilted || layout.feltDepthScaleRatio === 0) return 1;
  const aaTop = layout.feltTL[1];
  const aaHeight = layout.feltBR[1] - layout.feltTL[1];
  if (aaHeight <= 0) return 1;
  const v = (yFlat - aaTop) / aaHeight;
  return 1 + (v - 0.5) * 2 * layout.feltDepthScaleRatio;
}

export interface PointPos {
  /** Tilted (rendered) pixel coords — already passed through
   *  feltTransform when the felt is tilted. */
  readonly x: number;
  readonly tipX: number;
  readonly tipY: number;
  readonly y: number;
  /** Flat-space (pre-transform) coords. Identical to x / y / tipX /
   *  tipY when the felt isn't tilted. checkerCenter / hit-area / any
   *  helper that needs to do arithmetic on point geometry must use
   *  these — adding flat deltas to the tilted coords skips the
   *  perspective. */
  readonly xFlat: number;
  readonly yFlat: number;
  readonly tipXFlat: number;
  readonly tipYFlat: number;
  readonly topCheckerOffsetX: number;
  readonly stackDir: -1 | 1;
  readonly column: number;
}

export function pointCoords(layout: Layout, idx: number): PointPos {
  const isBottom = idx >= 12;
  const stackDir: -1 | 1 = isBottom ? -1 : 1;
  const column = isBottom ? idx - 12 : 11 - idx;

  const pointWidth = isBottom ? layout.bottomPointWidth : layout.topPointWidth;
  const playLeft = isBottom ? layout.bottomPlayLeft : layout.topPlayLeft;
  const barWidth = isBottom ? layout.bottomBarWidth : layout.topBarWidth;
  const pointCenterXs = isBottom ? layout.bottomPointCenterXs : layout.topPointCenterXs;
  const pointTipXs = isBottom ? layout.bottomPointTipXs : layout.topPointTipXs;
  const checkerOffsetXs = isBottom ? layout.bottomCheckerOffsetXs : layout.topCheckerOffsetXs;
  const pointHeight = isBottom ? layout.bottomPointHeight : layout.topPointHeight;
  const xFlat =
    pointCenterXs
      ? pointCenterXs[column]!
      : column < 6
      ? playLeft + (column + 0.5) * pointWidth
      : playLeft + 6 * pointWidth + barWidth + (column - 6 + 0.5) * pointWidth;
  const tipXFlat = pointTipXs ? pointTipXs[column]! : xFlat;
  const topCheckerOffsetX = checkerOffsetXs ? checkerOffsetXs[column]! : 0;
  const yFlat = isBottom ? layout.bottomPointY : layout.topPointY;
  const tipYFlat = yFlat + stackDir * pointHeight;
  // When the felt is tilted, map the base + tip through the bilinear
  // transform so triangles and stack anchors follow the perspective.
  const base = feltTransform(layout, xFlat, yFlat);
  const tip = feltTransform(layout, tipXFlat, tipYFlat);
  return {
    x: base.x,
    tipX: tip.x,
    tipY: tip.y,
    y: base.y,
    xFlat,
    yFlat,
    tipXFlat,
    tipYFlat,
    topCheckerOffsetX,
    stackDir,
    column,
  };
}

export function checkerCenter(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): { x: number; y: number } {
  const { checkerRadius, checkerScaleY } = layout;
  const verticalRadius = checkerRadius * checkerScaleY;
  const diameter = 2 * verticalRadius;
  const paddingRatio = pos.stackDir === 1 ? layout.topCheckerPadding : layout.bottomCheckerPadding;
  // Per-row depth / spacing so top and bottom rows can be tuned
  // independently. stackDir === 1 means a top-row point (stacks
  // downward into the play area).
  const pointHeight = pos.stackDir === 1 ? layout.topPointHeight : layout.bottomPointHeight;
  const checkerStackSpacing =
    pos.stackDir === 1 ? layout.topCheckerStackSpacing : layout.bottomCheckerStackSpacing;
  const startPadding = verticalRadius * paddingRatio;
  const naturalSpacing = diameter * checkerStackSpacing;
  const maxSpacing = count > 1 ? Math.max(1, (pointHeight - startPadding) / (count - 0.5)) : naturalSpacing;
  const spacing = count > 5 ? Math.min(naturalSpacing, maxSpacing) : naturalSpacing;
  const distanceFromBase = startPadding + stackIndex * spacing;
  const progress = Math.max(0, Math.min(1, distanceFromBase / Math.max(1, pointHeight)));
  const topCheckerOffsetX = stackIndex === count - 1 ? pos.topCheckerOffsetX : 0;
  // Compute the stack position in flat (axis-aligned) space, then
  // re-transform via feltTransform so tilted felts get perspective-
  // correct stacks. For non-tilted boards this is the identity.
  const xFlat = pos.xFlat + (pos.tipXFlat - pos.xFlat) * progress + topCheckerOffsetX;
  const yFlat = pos.yFlat + pos.stackDir * distanceFromBase;
  return feltTransform(layout, xFlat, yFlat);
}

export function checkerCenterY(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): number {
  return checkerCenter(layout, pos, stackIndex, count).y;
}
