// Mirrors the DB check constraint on board_theme_configs.id so the
// admin sees a clear inline error instead of a Postgres round-trip
// failure when adding a board.
const BOARD_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_REGEX.test(id)
}
