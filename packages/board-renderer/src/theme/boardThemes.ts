import {premiumTheme} from "./premium"
import type {Theme} from "./types"

export type BoardThemeId = string

// All board themes are managed via the Back Office (board_theme_configs
// table); the registry below is intentionally empty so nothing is
// hard-coded into the bundle. `getBoardTheme` falls back to the generic
// `premiumTheme` while a DB-managed theme is still loading, or if a
// caller asks for a theme id that doesn't exist anywhere.
export const DEFAULT_BOARD_THEME_ID: BoardThemeId = ""

export const boardThemes: Record<string, Theme> = {}

export function isBoardThemeId(value: string | null | undefined): value is BoardThemeId {
  return Boolean(value && value in boardThemes)
}

export function getBoardTheme(value: string | null | undefined): Theme {
  if (value && isBoardThemeId(value)) return boardThemes[value]
  return premiumTheme
}
