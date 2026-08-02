import type { Json } from '@shared/database';
import type { ThemeLayout } from './types';

export function isJsonObject(value: Json | undefined): value is Record<string, Json> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNumberArray(value: Json | undefined): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isPairOfNumbers(value: Json | undefined): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

/**
 * Exported so the back-office BoardPreview parses metadata with THE SAME
 * function gameplay uses. The explicit-undefined semantics matter: every
 * known key is present (value or undefined), so spreading the result over
 * premiumTheme.layout ERASES the premium placeholder's tilted-era per-point
 * calibration (topPointCenterXRatios etc.) for keys the board's metadata
 * doesn't set — letting the felt corners drive positions via computeLayout.
 * A pass-through parser (the preview's old local copy) kept those premium
 * arrays alive and pinned the preview's points to the old tilted board,
 * ignoring the felt-corner dots entirely.
 */
export function layoutFromMetadata(metadata: Json): ThemeLayout | undefined {
  if (!isJsonObject(metadata) || !isJsonObject(metadata.layout)) return undefined;
  const source = metadata.layout;
  const layout: ThemeLayout = {
    railWidthRatio: typeof source.railWidthRatio === 'number' ? source.railWidthRatio : undefined,
    barWidthRatio: typeof source.barWidthRatio === 'number' ? source.barWidthRatio : undefined,
    pointHeightRatio: typeof source.pointHeightRatio === 'number' ? source.pointHeightRatio : undefined,
    topPointHeightRatio:
      typeof source.topPointHeightRatio === 'number' ? source.topPointHeightRatio : undefined,
    bottomPointHeightRatio:
      typeof source.bottomPointHeightRatio === 'number'
        ? source.bottomPointHeightRatio
        : undefined,
    topPointYRatio: typeof source.topPointYRatio === 'number' ? source.topPointYRatio : undefined,
    bottomPointYRatio:
      typeof source.bottomPointYRatio === 'number' ? source.bottomPointYRatio : undefined,
    checkerRadiusRatio:
      typeof source.checkerRadiusRatio === 'number' ? source.checkerRadiusRatio : undefined,
    topPointWidthRatio:
      typeof source.topPointWidthRatio === 'number' ? source.topPointWidthRatio : undefined,
    bottomPointWidthRatio:
      typeof source.bottomPointWidthRatio === 'number' ? source.bottomPointWidthRatio : undefined,
    topPlayLeftRatio: typeof source.topPlayLeftRatio === 'number' ? source.topPlayLeftRatio : undefined,
    bottomPlayLeftRatio:
      typeof source.bottomPlayLeftRatio === 'number' ? source.bottomPlayLeftRatio : undefined,
    topBarWidthRatio: typeof source.topBarWidthRatio === 'number' ? source.topBarWidthRatio : undefined,
    bottomBarWidthRatio:
      typeof source.bottomBarWidthRatio === 'number' ? source.bottomBarWidthRatio : undefined,
    topPointCenterXRatios: isNumberArray(source.topPointCenterXRatios)
      ? source.topPointCenterXRatios
      : undefined,
    bottomPointCenterXRatios: isNumberArray(source.bottomPointCenterXRatios)
      ? source.bottomPointCenterXRatios
      : undefined,
    topPointTipXRatios: isNumberArray(source.topPointTipXRatios)
      ? source.topPointTipXRatios
      : undefined,
    bottomPointTipXRatios: isNumberArray(source.bottomPointTipXRatios)
      ? source.bottomPointTipXRatios
      : undefined,
    topCheckerOffsetXRatios: isNumberArray(source.topCheckerOffsetXRatios)
      ? source.topCheckerOffsetXRatios
      : undefined,
    bottomCheckerOffsetXRatios: isNumberArray(source.bottomCheckerOffsetXRatios)
      ? source.bottomCheckerOffsetXRatios
      : undefined,
    checkerScaleYRatio:
      typeof source.checkerScaleYRatio === 'number' ? source.checkerScaleYRatio : undefined,
    checkerStackSpacingRatio:
      typeof source.checkerStackSpacingRatio === 'number'
        ? source.checkerStackSpacingRatio
        : undefined,
    topCheckerStackSpacingRatio:
      typeof source.topCheckerStackSpacingRatio === 'number'
        ? source.topCheckerStackSpacingRatio
        : undefined,
    bottomCheckerStackSpacingRatio:
      typeof source.bottomCheckerStackSpacingRatio === 'number'
        ? source.bottomCheckerStackSpacingRatio
        : undefined,
    topCheckerPaddingRatio:
      typeof source.topCheckerPaddingRatio === 'number'
        ? source.topCheckerPaddingRatio
        : undefined,
    bottomCheckerPaddingRatio:
      typeof source.bottomCheckerPaddingRatio === 'number'
        ? source.bottomCheckerPaddingRatio
        : undefined,
    blackOffTrayXRatio:
      typeof source.blackOffTrayXRatio === 'number' ? source.blackOffTrayXRatio : undefined,
    blackOffTrayTopRatio:
      typeof source.blackOffTrayTopRatio === 'number' ? source.blackOffTrayTopRatio : undefined,
    blackOffTrayHeightRatio:
      typeof source.blackOffTrayHeightRatio === 'number'
        ? source.blackOffTrayHeightRatio
        : undefined,
    whiteOffTrayXRatio:
      typeof source.whiteOffTrayXRatio === 'number' ? source.whiteOffTrayXRatio : undefined,
    whiteOffTrayTopRatio:
      typeof source.whiteOffTrayTopRatio === 'number' ? source.whiteOffTrayTopRatio : undefined,
    whiteOffTrayHeightRatio:
      typeof source.whiteOffTrayHeightRatio === 'number'
        ? source.whiteOffTrayHeightRatio
        : undefined,
    offCheckerStackSpacingRatio:
      typeof source.offCheckerStackSpacingRatio === 'number'
        ? source.offCheckerStackSpacingRatio
        : undefined,
    offTrayInsetRatio:
      typeof source.offTrayInsetRatio === 'number' ? source.offTrayInsetRatio : undefined,
    offTrayMarginRatio:
      typeof source.offTrayMarginRatio === 'number' ? source.offTrayMarginRatio : undefined,
    offTrayMidGapRatio:
      typeof source.offTrayMidGapRatio === 'number' ? source.offTrayMidGapRatio : undefined,
    blackOffTrayTiltDeg:
      typeof source.blackOffTrayTiltDeg === 'number' ? source.blackOffTrayTiltDeg : undefined,
    whiteOffTrayTiltDeg:
      typeof source.whiteOffTrayTiltDeg === 'number' ? source.whiteOffTrayTiltDeg : undefined,
    feltInnerTopLeftRatio: isPairOfNumbers(source.feltInnerTopLeftRatio)
      ? source.feltInnerTopLeftRatio
      : undefined,
    feltInnerTopRightRatio: isPairOfNumbers(source.feltInnerTopRightRatio)
      ? source.feltInnerTopRightRatio
      : undefined,
    feltInnerBottomLeftRatio: isPairOfNumbers(source.feltInnerBottomLeftRatio)
      ? source.feltInnerBottomLeftRatio
      : undefined,
    feltInnerBottomRightRatio: isPairOfNumbers(source.feltInnerBottomRightRatio)
      ? source.feltInnerBottomRightRatio
      : undefined,
    feltLeftHalfTopLeftRatio: isPairOfNumbers(source.feltLeftHalfTopLeftRatio)
      ? source.feltLeftHalfTopLeftRatio
      : undefined,
    feltLeftHalfTopRightRatio: isPairOfNumbers(source.feltLeftHalfTopRightRatio)
      ? source.feltLeftHalfTopRightRatio
      : undefined,
    feltLeftHalfBottomLeftRatio: isPairOfNumbers(source.feltLeftHalfBottomLeftRatio)
      ? source.feltLeftHalfBottomLeftRatio
      : undefined,
    feltLeftHalfBottomRightRatio: isPairOfNumbers(source.feltLeftHalfBottomRightRatio)
      ? source.feltLeftHalfBottomRightRatio
      : undefined,
    feltRightHalfTopLeftRatio: isPairOfNumbers(source.feltRightHalfTopLeftRatio)
      ? source.feltRightHalfTopLeftRatio
      : undefined,
    feltRightHalfTopRightRatio: isPairOfNumbers(source.feltRightHalfTopRightRatio)
      ? source.feltRightHalfTopRightRatio
      : undefined,
    feltRightHalfBottomLeftRatio: isPairOfNumbers(source.feltRightHalfBottomLeftRatio)
      ? source.feltRightHalfBottomLeftRatio
      : undefined,
    feltRightHalfBottomRightRatio: isPairOfNumbers(source.feltRightHalfBottomRightRatio)
      ? source.feltRightHalfBottomRightRatio
      : undefined,
    feltDepthScaleRatio:
      typeof source.feltDepthScaleRatio === 'number' ? source.feltDepthScaleRatio : undefined,
  };
  return layout;
}

