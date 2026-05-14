import { premiumTheme } from './premium';
import type { Theme } from './types';

export type BoardThemeId = string;

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = 'classic-green';

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
};

export function isBoardThemeId(value: string | null | undefined): value is BoardThemeId {
  return Boolean(value && value in boardThemes);
}

export function getBoardTheme(value: string | null | undefined): Theme {
  return boardThemes[isBoardThemeId(value) ? value : DEFAULT_BOARD_THEME_ID];
}
