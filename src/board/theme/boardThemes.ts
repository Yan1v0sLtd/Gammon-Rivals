import { premiumTheme } from './premium';
import type { Theme } from './types';

export type BoardThemeId = string;

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = 'premium-purple';

const premiumPurpleLayout = {
  ...premiumTheme.layout,
  railWidthRatio: 0.205,
  barWidthRatio: 0.045,
  pointHeightRatio: 0.305,
  topPointYRatio: 0.076,
  bottomPointYRatio: 0.898,
  checkerRadiusRatio: 0.47,
  checkerScaleYRatio: 0.92,
  checkerStackSpacingRatio: 0.74,
  topCheckerPaddingRatio: 0.9,
  bottomCheckerPaddingRatio: 0.32,
  topPointCenterXRatios: [
    0.326, 0.37, 0.414, 0.459, 0.503, 0.547,
    0.592, 0.636, 0.681, 0.725, 0.769, 0.813,
  ],
  topPointTipXRatios: [
    0.328, 0.371, 0.415, 0.459, 0.503, 0.546,
    0.592, 0.635, 0.679, 0.723, 0.767, 0.81,
  ],
  bottomPointCenterXRatios: [
    0.322, 0.367, 0.411, 0.456, 0.502, 0.547,
    0.593, 0.638, 0.684, 0.729, 0.774, 0.819,
  ],
  bottomPointTipXRatios: [
    0.325, 0.369, 0.413, 0.457, 0.502, 0.546,
    0.592, 0.636, 0.681, 0.725, 0.77, 0.814,
  ],
  topCheckerOffsetXRatios: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  bottomCheckerOffsetXRatios: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  blackOffTrayXRatio: 0.107,
  blackOffTrayTopRatio: 0.135,
  blackOffTrayHeightRatio: 0.285,
  whiteOffTrayXRatio: 0.892,
  whiteOffTrayTopRatio: 0.565,
  whiteOffTrayHeightRatio: 0.285,
  offCheckerStackSpacingRatio: 0.54,
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
