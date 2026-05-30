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
  backgroundImage: '/lobby/backgrounds/classic-green.webp',
  layout: {
    railWidthRatio: 0.205,
    barWidthRatio: 0.05,
    pointHeightRatio: 0.25,
    topPointYRatio: 0.065,
    bottomPointYRatio: 0.903,
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
    bottomCheckerPaddingRatio: 0.2,
    topPointCenterXRatios: [
      0.167, 0.218, 0.27, 0.321, 0.375, 0.428,
      0.563, 0.616, 0.67, 0.723, 0.777, 0.83,
    ],
    topPointTipXRatios: [
      0.163, 0.216, 0.268, 0.32, 0.375, 0.427,
      0.565, 0.617, 0.672, 0.725, 0.781, 0.831,
    ],
    bottomPointCenterXRatios: [
      0.158, 0.21, 0.264, 0.319, 0.374, 0.43,
      0.566, 0.619, 0.673, 0.729, 0.785, 0.843,
    ],
    bottomPointTipXRatios: [
      0.159, 0.212, 0.2655, 0.32, 0.375, 0.43,
      0.564, 0.618, 0.672, 0.727, 0.782, 0.837,
    ],
    topCheckerOffsetXRatios: [
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ],
    bottomCheckerOffsetXRatios: [
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ],
    // The absolute bear-off tray ratios (black/whiteOffTray X/Top/Height)
    // were removed on purpose. The trays now DERIVE from the felt corners
    // in computeLayout, and the absolute fallback for corner-less themes
    // like this one lives there (?? 0.925 / 0.145 / 0.61). Keeping them
    // here made them leak through the back-office preview's layout merge
    // ({...premiumTheme.layout, ...boardMetadata}), where they tripped the
    // "explicit per-board override" check and bypassed the felt
    // derivation — so the preview showed the old fixed position.
    offCheckerStackSpacingRatio: 0.56,
  },
};
