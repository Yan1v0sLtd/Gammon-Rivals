import { premiumTheme } from './premium';
import type { Theme } from './types';

export type BoardThemeId = 'classic-green' | 'ocean-blue' | 'royal-purple';

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = 'classic-green';

export const boardThemes: Record<BoardThemeId, Theme> = {
  'classic-green': {
    ...premiumTheme,
    name: 'classic-green',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/classic-green/board.webp',
    },
  },
  'ocean-blue': {
    ...premiumTheme,
    name: 'ocean-blue',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/ocean-blue/board.webp',
    },
  },
  'royal-purple': {
    ...premiumTheme,
    name: 'royal-purple',
    assets: {
      ...premiumTheme.assets,
      board: '/themes/royal-purple/board.webp',
    },
  },
};

export function isBoardThemeId(value: string | null | undefined): value is BoardThemeId {
  return value === 'classic-green' || value === 'ocean-blue' || value === 'royal-purple';
}

export function getBoardTheme(value: string | null | undefined): Theme {
  return boardThemes[isBoardThemeId(value) ? value : DEFAULT_BOARD_THEME_ID];
}
