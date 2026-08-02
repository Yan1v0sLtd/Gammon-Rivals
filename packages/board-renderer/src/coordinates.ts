import type { ThemeLayout } from './theme';

type RatioPair = readonly [number, number];

/**
 * One half of the board (6 points), positioned by its own four-corner
 * quad — the art-agnostic model. Flat-space reference box = the
 * configured TL/BR corners (same convention as the single felt quad);
 * TR/BL default axis-aligned and only engage the bilinear transform
 * when they deviate. With both halves configured, the bar is simply
 * the measured gap between the two quads — nothing about the painted
 * bar's width or the halves' relative size/offset is assumed.
 */
export interface HalfGeom {
  readonly flatL: number;
  readonly flatT: number;
  readonly flatR: number;
  readonly flatB: number;
  readonly quadTL: RatioPair;
  readonly quadTR: RatioPair;
  readonly quadBL: RatioPair;
  readonly quadBR: RatioPair;
  readonly tilted: boolean;
  /** This half's point column width: flat width / 6. */
  readonly pointWidth: number;
  /** Row anchors — the half's own felt edges, unless the global
   *  top/bottomPointYRatio overrides are explicitly set. */
  readonly topY: number;
  readonly bottomY: number;
}

function buildHalf(
  width: number,
  height: number,
  tlRatio: RatioPair,
  brRatio: RatioPair,
  trRatio: RatioPair | undefined,
  blRatio: RatioPair | undefined,
  themeLayout?: ThemeLayout
): HalfGeom {
  const flatL = width * tlRatio[0];
  const flatT = height * tlRatio[1];
  const flatR = width * brRatio[0];
  const flatB = height * brRatio[1];
  const quadTL: RatioPair = [flatL, flatT];
  const quadBR: RatioPair = [flatR, flatB];
  const quadTR: RatioPair = trRatio
    ? [width * trRatio[0], height * trRatio[1]]
    : [flatR, flatT];
  const quadBL: RatioPair = blRatio
    ? [width * blRatio[0], height * blRatio[1]]
    : [flatL, flatB];
  const tiltEps = 0.5; // px tolerance for "axis-aligned"
  const tilted =
    Math.abs(quadTR[0] - flatR) > tiltEps ||
    Math.abs(quadTR[1] - flatT) > tiltEps ||
    Math.abs(quadBL[0] - flatL) > tiltEps ||
    Math.abs(quadBL[1] - flatB) > tiltEps;
  return {
    flatL,
    flatT,
    flatR,
    flatB,
    quadTL,
    quadTR,
    quadBL,
    quadBR,
    tilted,
    pointWidth: Math.max(1, flatR - flatL) / 6,
    topY:
      themeLayout?.topPointYRatio !== undefined
        ? Math.round(height * themeLayout.topPointYRatio)
        : Math.round(flatT),
    bottomY:
      themeLayout?.bottomPointYRatio !== undefined
        ? Math.round(height * themeLayout.bottomPointYRatio)
        : Math.round(flatB),
  };
}

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
  /** Per-half quads (see HalfGeom). Both set or both null — null means
   *  the theme uses the legacy single-quad model above. */
  readonly leftHalf: HalfGeom | null;
  readonly rightHalf: HalfGeom | null;
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
  // PER-HALF QUADS — active only when BOTH halves provide TL + BR. The
  // play area, bar and point widths are then MEASURED from the quads:
  // the bar is the gap between the halves (checkers can never overlap
  // the painted bar) and each half divides its own width into 6 points,
  // so unequal / offset halves come straight from the art. Boards
  // without half quads run the legacy single-quad math below unchanged.
  const lTL = themeLayout?.feltLeftHalfTopLeftRatio;
  const lBR = themeLayout?.feltLeftHalfBottomRightRatio;
  const rTL = themeLayout?.feltRightHalfTopLeftRatio;
  const rBR = themeLayout?.feltRightHalfBottomRightRatio;
  const halvesConfigured = Boolean(lTL && lBR && rTL && rBR);
  const leftHalf =
    halvesConfigured && lTL && lBR
      ? buildHalf(
          width,
          height,
          lTL,
          lBR,
          themeLayout?.feltLeftHalfTopRightRatio,
          themeLayout?.feltLeftHalfBottomLeftRatio,
          themeLayout
        )
      : null;
  const rightHalf =
    halvesConfigured && rTL && rBR
      ? buildHalf(
          width,
          height,
          rTL,
          rBR,
          themeLayout?.feltRightHalfTopRightRatio,
          themeLayout?.feltRightHalfBottomLeftRatio,
          themeLayout
        )
      : null;
  const halves = leftHalf && rightHalf ? { left: leftHalf, right: rightHalf } : null;
  const playLeft = halves ? halves.left.flatL : feltL;
  const playWidth = halves
    ? Math.max(1, halves.right.flatR - halves.left.flatL)
    : Math.max(1, feltR - feltL);
  const barWidth = halves
    ? Math.max(0, halves.right.flatL - halves.left.flatR)
    : Math.round(playWidth * (themeLayout?.barWidthRatio ?? 0.08));
  // With halves, the radius-driving point width is the NARROWER half's,
  // so one global checker size fits both halves' points.
  const pointWidth = halves
    ? Math.min(halves.left.pointWidth, halves.right.pointWidth)
    : (playWidth - barWidth) / 12;
  const barX = halves ? halves.left.flatR : playLeft + 6 * pointWidth;
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
  // Felt-derived defaults for each tray (used per-colour unless that
  // colour has explicit X/Top/Height ratios — e.g. dragged into place via
  // the back-office "Bear-off trays" editor). White and black resolve
  // INDEPENDENTLY: dragging one doesn't pull the other off felt-anchoring.
  let derivedBlackX = width * 0.925;
  let derivedBlackTop = height * 0.145;
  let derivedBlackHeight = height * 0.255;
  let derivedWhiteX = width * 0.925;
  let derivedWhiteTop = height * 0.61;
  let derivedWhiteHeight = height * 0.255;
  // Tray anchoring prefers the measured half quads (right half's outer
  // edge + the two halves' combined vertical extent); single-quad boards
  // keep deriving from their felt corners as before.
  const trayFelt = halves
    ? {
        right: Math.max(halves.right.quadTR[0], halves.right.quadBR[0]),
        top: Math.min(
          halves.left.quadTL[1],
          halves.left.quadTR[1],
          halves.right.quadTL[1],
          halves.right.quadTR[1]
        ),
        bottom: Math.max(
          halves.left.quadBL[1],
          halves.left.quadBR[1],
          halves.right.quadBL[1],
          halves.right.quadBR[1]
        ),
      }
    : feltTLRatio || feltBRRatio
      ? {
          right: Math.max(feltTR[0], feltBR[0]),
          top: Math.min(feltTL[1], feltTR[1]),
          bottom: Math.max(feltBL[1], feltBR[1]),
        }
      : null;
  if (trayFelt) {
    const feltRightEdge = trayFelt.right;
    const feltTopEdge = trayFelt.top;
    const feltBottomEdge = trayFelt.bottom;
    const feltMid = (feltTopEdge + feltBottomEdge) / 2;
    const feltH = Math.max(1, feltBottomEdge - feltTopEdge);
    const railGap = Math.max(0, width - feltRightEdge);
    const trayX = feltRightEdge + railGap * offTrayInset;
    const margin = feltH * offTrayMargin;
    const halfGap = (feltH * offTrayMidGap) / 2;
    derivedBlackX = trayX;
    derivedBlackTop = feltTopEdge + margin;
    derivedBlackHeight = Math.max(1, feltMid - halfGap - derivedBlackTop);
    derivedWhiteX = trayX;
    derivedWhiteTop = feltMid + halfGap;
    derivedWhiteHeight = Math.max(1, feltBottomEdge - margin - derivedWhiteTop);
  }
  const blackExplicit = themeLayout?.blackOffTrayXRatio !== undefined;
  const whiteExplicit = themeLayout?.whiteOffTrayXRatio !== undefined;
  const blackOffTrayX = blackExplicit ? width * (themeLayout?.blackOffTrayXRatio ?? 0.925) : derivedBlackX;
  const blackOffTrayTop = blackExplicit
    ? height * (themeLayout?.blackOffTrayTopRatio ?? 0.145)
    : derivedBlackTop;
  const blackOffTrayHeight = blackExplicit
    ? height * (themeLayout?.blackOffTrayHeightRatio ?? 0.255)
    : derivedBlackHeight;
  const whiteOffTrayX = whiteExplicit ? width * (themeLayout?.whiteOffTrayXRatio ?? 0.925) : derivedWhiteX;
  const whiteOffTrayTop = whiteExplicit
    ? height * (themeLayout?.whiteOffTrayTopRatio ?? 0.61)
    : derivedWhiteTop;
  const whiteOffTrayHeight = whiteExplicit
    ? height * (themeLayout?.whiteOffTrayHeightRatio ?? 0.255)
    : derivedWhiteHeight;
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
    leftHalf,
    rightHalf,
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
  return bilinearQuad(
    layout.feltTL[0],
    layout.feltTL[1],
    layout.feltBR[0] - layout.feltTL[0],
    layout.feltBR[1] - layout.feltTL[1],
    layout.feltTL,
    layout.feltTR,
    layout.feltBL,
    layout.feltBR,
    x,
    y
  );
}

/** Same bilinear mapping as feltTransform, against ONE half's quad. */
export function halfTransform(half: HalfGeom, x: number, y: number): { x: number; y: number } {
  if (!half.tilted) return { x, y };
  return bilinearQuad(
    half.flatL,
    half.flatT,
    half.flatR - half.flatL,
    half.flatB - half.flatT,
    half.quadTL,
    half.quadTR,
    half.quadBL,
    half.quadBR,
    x,
    y
  );
}

function bilinearQuad(
  aaLeft: number,
  aaTop: number,
  aaWidth: number,
  aaHeight: number,
  tl: RatioPair,
  tr: RatioPair,
  bl: RatioPair,
  br: RatioPair,
  x: number,
  y: number
): { x: number; y: number } {
  if (aaWidth <= 0 || aaHeight <= 0) return { x, y };
  const u = (x - aaLeft) / aaWidth;
  const v = (y - aaTop) / aaHeight;
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = (1 - u) * v;
  const d = u * v;
  return {
    x: tl[0] * a + tr[0] * b + bl[0] * c + br[0] * d,
    y: tl[1] * a + tr[1] * b + bl[1] * c + br[1] * d,
  };
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
  /** The half quad this point was positioned by, or null on the legacy
   *  single-quad path. checkerCenter must transform stack positions
   *  through the SAME quad the point's base/tip used. */
  readonly half: HalfGeom | null;
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
  // Per-half quad path: when the theme configures both halves, this
  // point's geometry comes from ITS half's quad — columns 0-5 from the
  // left, 6-11 from the right. The per-point center/tip arrays keep
  // absolute precedence (premium placeholder / alignment escape hatch).
  const half =
    layout.leftHalf && layout.rightHalf && !pointCenterXs
      ? column < 6
        ? layout.leftHalf
        : layout.rightHalf
      : null;
  const xFlat = pointCenterXs
    ? pointCenterXs[column]!
    : half
      ? half.flatL + ((column % 6) + 0.5) * half.pointWidth
      : column < 6
        ? playLeft + (column + 0.5) * pointWidth
        : playLeft + 6 * pointWidth + barWidth + (column - 6 + 0.5) * pointWidth;
  const tipXFlat = pointTipXs ? pointTipXs[column]! : xFlat;
  const topCheckerOffsetX = checkerOffsetXs ? checkerOffsetXs[column]! : 0;
  const yFlat = half
    ? isBottom
      ? half.bottomY
      : half.topY
    : isBottom
      ? layout.bottomPointY
      : layout.topPointY;
  const tipYFlat = yFlat + stackDir * pointHeight;
  // When the quad is tilted, map the base + tip through the bilinear
  // transform so triangles and stack anchors follow the perspective —
  // against the point's own half quad when one is configured.
  const base = half ? halfTransform(half, xFlat, yFlat) : feltTransform(layout, xFlat, yFlat);
  const tip = half
    ? halfTransform(half, tipXFlat, tipYFlat)
    : feltTransform(layout, tipXFlat, tipYFlat);
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
    half,
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
  // re-transform so tilted quads get perspective-correct stacks — via
  // the point's own half quad when one is configured, else the single
  // felt quad. For non-tilted boards this is the identity.
  const xFlat = pos.xFlat + (pos.tipXFlat - pos.xFlat) * progress + topCheckerOffsetX;
  const yFlat = pos.yFlat + pos.stackDir * distanceFromBase;
  return pos.half ? halfTransform(pos.half, xFlat, yFlat) : feltTransform(layout, xFlat, yFlat);
}

export function checkerCenterY(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): number {
  return checkerCenter(layout, pos, stackIndex, count).y;
}
