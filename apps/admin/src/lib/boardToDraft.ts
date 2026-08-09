import type {Database} from "../../../../packages/shared/src/database"

import {jsonToString} from "./jsonToString"
import {metadataText} from "./metadataText"

type BoardThemeConfig = Database["public"]["Tables"]["board_theme_configs"]["Row"]

export type BoardDraft = {
  id: string,
  display_name: string,
  preview_image: string,
  gameplay_image: string,
  lobby_background_image: string,
  gameplay_background_image: string,
  white_checker_image: string,
  black_checker_image: string,
  dice_image: string,
  tray_image: string,
  holder_image: string,
  unlock_level: string,
  price_coins: string,
  price_gems: string,
  is_enabled: boolean,
  is_featured: boolean,
  sort_order: string,
  metadata: string,
}

export function boardToDraft(row?: BoardThemeConfig): BoardDraft {
  return {
    id: row?.id ?? "",
    display_name: row?.display_name ?? "",
    preview_image: row?.preview_image ?? "",
    gameplay_image: row?.gameplay_image ?? "",
    lobby_background_image: row?.lobby_background_image ?? "",
    gameplay_background_image: metadataText(row?.metadata, "gameplayBackgroundImage"),
    white_checker_image: row?.white_checker_image ?? "",
    black_checker_image: row?.black_checker_image ?? "",
    dice_image: row?.dice_image ?? "",
    tray_image: row?.tray_image ?? "",
    holder_image: row?.holder_image ?? "",
    unlock_level: row?.unlock_level.toString() ?? "1",
    price_coins: row?.price_coins.toString() ?? "0",
    price_gems: row?.price_gems?.toString() ?? "0",
    is_enabled: row?.is_enabled ?? true,
    is_featured: row?.is_featured ?? false,
    sort_order: row?.sort_order.toString() ?? "0",
    metadata: jsonToString(row?.metadata, "{}"),
  }
}
