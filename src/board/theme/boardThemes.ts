import { premiumTheme } from './premium';
import type { Theme } from './types';

export type BoardThemeId = string;

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = 'premium-purple';

const premiumPurpleLayout = {
  ...premiumTheme.layout,
  railWidthRatio: 0.205,
  barWidthRatio: 0.045,
  pointHeightRatio: 0.262,
  bottomPointHeightRatio: 0.286,
  topPointYRatio: 0.07,
  bottomPointYRatio: 0.858,
  checkerRadiusRatio: 0.47,
  checkerScaleYRatio: 0.92,
  checkerStackSpacingRatio: 0.8,
  bottomCheckerStackSpacingRatio: 0.84,
  topCheckerPaddingRatio: 1,
  bottomCheckerPaddingRatio: 0.28,
  topPointCenterXRatios: [
    0.213, 0.258, 0.304, 0.349, 0.399, 0.442,
    0.553, 0.594, 0.64, 0.687, 0.735, 0.784,
  ],
  topPointTipXRatios: [
    0.189, 0.24, 0.292, 0.34, 0.389, 0.441,
    0.555, 0.599, 0.646, 0.697, 0.747, 0.795,
  ],
  bottomPointCenterXRatios: [
    0.154, 0.208, 0.262, 0.321, 0.378, 0.434,
    0.564, 0.617, 0.673, 0.727, 0.785, 0.845,
  ],
  bottomPointTipXRatios: [
    0.173, 0.224, 0.2775, 0.33, 0.383, 0.438,
    0.56, 0.614, 0.664, 0.717, 0.768, 0.821,
  ],
  topCheckerOffsetXRatios: [
    0, 0.018, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  bottomCheckerOffsetXRatios: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  blackOffTrayXRatio: 0.925,
  blackOffTrayTopRatio: 0.145,
  blackOffTrayHeightRatio: 0.255,
  whiteOffTrayXRatio: 0.925,
  whiteOffTrayTopRatio: 0.61,
  whiteOffTrayHeightRatio: 0.255,
  offCheckerStackSpacingRatio: 0.56,
} satisfies NonNullable<typeof premiumTheme.layout>;

export const boardThemes: Record<string, Theme> = {
  'classic-green': {
    ...premiumTheme,
    name: 'classic-green',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/classic-green/board.webp',
    },
    backgroundImage: '/lobby/backgrounds/classic-green.webp',
    gameplayBackgroundImage: '/lobby/backgrounds/classic-green.webp',
  },
  'ocean-blue': {
    ...premiumTheme,
    name: 'ocean-blue',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/ocean-blue/board.webp',
    },
    backgroundImage: '/lobby/backgrounds/ocean-blue.webp',
    gameplayBackgroundImage: '/lobby/backgrounds/ocean-blue.webp',
  },
  'royal-purple': {
    ...premiumTheme,
    name: 'royal-purple',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/royal-purple/board.webp',
    },
    backgroundImage: '/lobby/backgrounds/royal-purple.webp',
    gameplayBackgroundImage: '/lobby/backgrounds/royal-purple.webp',
  },
  'premium-purple': {
    ...premiumTheme,
    name: 'premium-purple',
    colors: {
      ...premiumTheme.colors,
      felt: 0x542141,
      feltVignette: 0x170714,
      pointLightBase: 0xffe4b1,
      pointLightTip: 0x9b663e,
      pointDarkBase: 0x5d1f4d,
      pointDarkTip: 0x18071e,
      trayBg: 0x1a0c0a,
    },
    assets: {
      ...premiumTheme.assets,
      board: '/themes/premium-purple/board.webp',
      whiteChecker: '/themes/premium-purple/checker-white.webp',
      blackChecker: '/themes/premium-purple/checker-black.webp',
    },
    backgroundImage: '/gameplay/premium-purple/background.webp',
    gameplayBackgroundImage: '/gameplay/premium-purple/background.webp',
    layout: premiumPurpleLayout,
  },
};

export function isBoardThemeId(value: string | null | undefined): value is BoardThemeId {
  return Boolean(value && value in boardThemes);
}

export function getBoardTheme(value: string | null | undefined): Theme {
  return boardThemes[isBoardThemeId(value) ? value : DEFAULT_BOARD_THEME_ID];
}
