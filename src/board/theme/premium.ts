import { woodTheme } from './wood';
import type { Theme } from './types';

export const premiumTheme: Theme = {
  name: 'premium',
  colors: {
    ...woodTheme.colors,
    felt: 0xe9b86f,
    pointLightBase: 0xffe6a8,
    pointLightTip: 0xe3a65d,
    pointDarkBase: 0xb85d2d,
    pointDarkTip: 0x6e2b15,
    trayBg: 0x8f1719,
  },
  assets: {
    board: '/themes/premium/board-tilted.png',
    whiteChecker: '/themes/premium/checker-white.svg',
    blackChecker: '/themes/premium/checker-black.svg',
  },
  layout: {
    railWidthRatio: 0.205,
    barWidthRatio: 0.05,
    pointHeightRatio: 0.25,
    topPointYRatio: 0.12,
    bottomPointYRatio: 0.828,
    checkerRadiusRatio: 0.54,
    checkerScaleYRatio: 0.96,
    topPlayLeftRatio: 0.23,
    bottomPlayLeftRatio: 0.205,
    topPointWidthRatio: 0.044,
    bottomPointWidthRatio: 0.051,
    topBarWidthRatio: 0.04,
    bottomBarWidthRatio: 0.04,
    checkerStackSpacingRatio: 0.8,
    topCheckerPaddingRatio: 1,
    bottomCheckerPaddingRatio: 0.44,
    topPointCenterXRatios: [
      0.247, 0.29, 0.332, 0.375, 0.417, 0.46,
      0.543, 0.586, 0.628, 0.671, 0.713, 0.756,
    ],
    topPointTipXRatios: [
      0.225, 0.272, 0.318, 0.364, 0.409, 0.455,
      0.545, 0.591, 0.637, 0.683, 0.729, 0.775,
    ],
    bottomPointCenterXRatios: [
      0.182, 0.236, 0.29, 0.343, 0.394, 0.448,
      0.55, 0.603, 0.655, 0.707, 0.76, 0.813,
    ],
    bottomPointTipXRatios: [
      0.205, 0.255, 0.305, 0.354, 0.403, 0.452,
      0.548, 0.596, 0.645, 0.694, 0.742, 0.792,
    ],
    topCheckerOffsetXRatios: [
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ],
    bottomCheckerOffsetXRatios: [
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ],
  },
};
