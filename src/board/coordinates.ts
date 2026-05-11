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
  readonly topPointY: number;
  readonly bottomPointY: number;
  readonly checkerRadius: number;
  readonly checkerScaleY: number;
  readonly checkerStackSpacing: number;
  readonly topCheckerPadding: number;
  readonly bottomCheckerPadding: number;
}

export function computeLayout(width: number, height: number, themeLayout?: ThemeLayout): Layout {
  const railWidth = Math.round(width * (themeLayout?.railWidthRatio ?? 0.07));
  const playLeft = railWidth;
  const playWidth = width - 2 * railWidth;
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
  const pointHeight = Math.round(height * (themeLayout?.pointHeightRatio ?? 0.44));
  const topPointY = Math.round(height * (themeLayout?.topPointYRatio ?? 0));
  const bottomPointY = Math.round(height * (themeLayout?.bottomPointYRatio ?? 1));
  const checkerRadius = Math.floor(pointWidth * (themeLayout?.checkerRadiusRatio ?? 0.42));
  const checkerScaleY = themeLayout?.checkerScaleYRatio ?? 1;
  const checkerStackSpacing = themeLayout?.checkerStackSpacingRatio ?? 1;
  const topCheckerPadding = themeLayout?.topCheckerPaddingRatio ?? 1;
  const bottomCheckerPadding = themeLayout?.bottomCheckerPaddingRatio ?? 1;
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
    topPointY,
    bottomPointY,
    checkerRadius,
    checkerScaleY,
    checkerStackSpacing,
    topCheckerPadding,
    bottomCheckerPadding,
  };
}

export interface PointPos {
  readonly x: number;
  readonly tipX: number;
  readonly topCheckerOffsetX: number;
  readonly y: number;
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
  const x =
    pointCenterXs
      ? pointCenterXs[column]!
      : column < 6
      ? playLeft + (column + 0.5) * pointWidth
      : playLeft + 6 * pointWidth + barWidth + (column - 6 + 0.5) * pointWidth;
  const tipX = pointTipXs ? pointTipXs[column]! : x;
  const topCheckerOffsetX = checkerOffsetXs ? checkerOffsetXs[column]! : 0;
  const y = isBottom ? layout.bottomPointY : layout.topPointY;
  return { x, tipX, topCheckerOffsetX, y, stackDir, column };
}

export function checkerCenter(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): { x: number; y: number } {
  const { checkerRadius, checkerScaleY, checkerStackSpacing, pointHeight } = layout;
  const verticalRadius = checkerRadius * checkerScaleY;
  const diameter = 2 * verticalRadius;
  const paddingRatio = pos.stackDir === 1 ? layout.topCheckerPadding : layout.bottomCheckerPadding;
  const startPadding = verticalRadius * paddingRatio;
  const naturalSpacing = diameter * checkerStackSpacing;
  const maxSpacing = count > 1 ? Math.max(1, (pointHeight - startPadding) / (count - 0.5)) : naturalSpacing;
  const spacing = count > 5 ? Math.min(naturalSpacing, maxSpacing) : naturalSpacing;
  const distanceFromBase = startPadding + stackIndex * spacing;
  const progress = Math.max(0, Math.min(1, distanceFromBase / Math.max(1, pointHeight)));
  const topCheckerOffsetX = stackIndex === count - 1 ? pos.topCheckerOffsetX : 0;
  return {
    x: pos.x + (pos.tipX - pos.x) * progress + topCheckerOffsetX,
    y: pos.y + pos.stackDir * distanceFromBase,
  };
}

export function checkerCenterY(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): number {
  return checkerCenter(layout, pos, stackIndex, count).y;
}
