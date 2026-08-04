import {useMemo} from "react"

import {getBoardTheme} from "../../../../../packages/board-renderer/src/theme/boardThemes"
import {isJsonObject, layoutFromMetadata} from "../../../../../packages/board-renderer/src/theme/metadata"
import {premiumTheme} from "../../../../../packages/board-renderer/src/theme/premium"
import type {Theme} from "../../../../../packages/board-renderer/src/theme/types"
import type {Json} from "../../../../../packages/shared/src/database"
import {getPersistedBoardId} from "../../board/theme/selectedBoard"
import {isSupabaseConfigured} from "../../lib/supabase"

import {useGetLobbyBoardsQuery} from "./lobbyApi"
import type {BoardThemeConfigRow} from "./lobbyData"

function metadataText(metadata: Json, key: string): string | undefined {
  if (!isJsonObject(metadata)) return undefined
  const value = metadata[key]
  return typeof value === "string" ? value : undefined
}

function normalizePublicAssetPath(path: string | null | undefined): string | undefined {
  const trimmed = path?.trim()
  if (!trimmed) return undefined
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

export function themeFromBoardConfig(config: BoardThemeConfigRow): Theme {
  return {
    ...premiumTheme,
    name: config.id,
    assets: {
      ...premiumTheme.assets,
      board: normalizePublicAssetPath(config.gameplay_image) ?? premiumTheme.assets?.board,
      whiteChecker: normalizePublicAssetPath(config.white_checker_image) ?? premiumTheme.assets?.whiteChecker,
      blackChecker: normalizePublicAssetPath(config.black_checker_image) ?? premiumTheme.assets?.blackChecker,
    },
    backgroundImage: normalizePublicAssetPath(config.lobby_background_image) ?? premiumTheme.backgroundImage,
    gameplayBackgroundImage: normalizePublicAssetPath(metadataText(config.metadata, "gameplayBackgroundImage")) ?? normalizePublicAssetPath(config.lobby_background_image) ?? premiumTheme.gameplayBackgroundImage ?? premiumTheme.backgroundImage,
    layout: {
      ...premiumTheme.layout, ...layoutFromMetadata(config.metadata),
    },
    diceImage: normalizePublicAssetPath(config.dice_image),
  }
}

export type BoardThemeConfigResult = {
  readonly theme: Theme,
  readonly isLoading: boolean,
}

function selectBoardConfig(
  boards: readonly BoardThemeConfigRow[] | undefined,
  requestedId: string | null,
): BoardThemeConfigRow | undefined {
  if (!boards) return undefined
  const requested = requestedId ? boards.find((board) => board.id === requestedId) : undefined
  if (requested) return requested
  return [...boards].sort((a, b) => a.sort_order - b.sort_order)[0]
}

export function useBoardThemeConfig(boardId: string | null | undefined): BoardThemeConfigResult {
  const {
    data: boards,
    isLoading: queryLoading,
    isUninitialized,
  } = useGetLobbyBoardsQuery(undefined, {
    skip: !isSupabaseConfigured,
  })
  const placeholderTheme = useMemo(() => getBoardTheme(boardId), [boardId])
  const requestedId = boardId?.trim() ?? getPersistedBoardId() ?? null
  const selectedConfig = useMemo(() => selectBoardConfig(boards, requestedId), [boards, requestedId])
  const selectedTheme = useMemo(
    () => selectedConfig ? themeFromBoardConfig(selectedConfig) : placeholderTheme,
    [placeholderTheme, selectedConfig],
  )

  return {
    theme: selectedTheme,
    isLoading: queryLoading || (isSupabaseConfigured && isUninitialized),
  }
}
