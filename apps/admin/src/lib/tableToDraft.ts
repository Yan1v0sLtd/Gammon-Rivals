import type {Database} from "../../../../packages/shared/src/database"

import {jsonToString} from "./jsonToString"

type TableConfig = Database["public"]["Tables"]["table_configs"]["Row"]

export type TableDraft = {
  id: string,
  kind: "standard" | "difficulty",
  display_name: string,
  description: string,
  entry_fee_coins: string,
  prize_coins: string,
  prize_coins_loss: string,
  required_level: string,
  match_target: string,
  allow_ai: boolean,
  allow_online: boolean,
  is_enabled: boolean,
  sort_order: string,
  xp_multiplier_pct: string,
  base_xp_win: string,
  turn_seconds: string,
  accent_color: string,
  ai_level: "easy" | "medium" | "hard",
  target_rtp_pct: string,
  metadata: string,
}

export function tableToDraft(row?: TableConfig, defaultKind: "standard" | "difficulty" = "standard"): TableDraft {
  return {
    id: row?.id ?? "",
    kind: row?.kind ?? defaultKind,
    display_name: row?.display_name ?? "",
    description: row?.description ?? "",
    entry_fee_coins: row?.entry_fee_coins.toString() ?? "0",
    prize_coins: row?.prize_coins.toString() ?? "0",
    prize_coins_loss: row?.prize_coins_loss.toString() ?? "0",
    required_level: row?.required_level.toString() ?? "1",
    match_target: row?.match_target.toString() ?? "7",
    allow_ai: row?.allow_ai ?? (defaultKind === "difficulty"),
    allow_online: row?.allow_online ?? true,
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? "0",
    xp_multiplier_pct: row?.xp_multiplier_pct.toString() ?? "100",
    base_xp_win: row?.base_xp_win.toString() ?? "0",
    turn_seconds: row?.turn_seconds.toString() ?? "45",
    accent_color: row?.accent_color ?? "gold",
    ai_level: row?.ai_level ?? "medium",
    target_rtp_pct: row?.target_rtp_pct.toString() ?? "90",
    metadata: jsonToString(row?.metadata, "{}"),
  }
}
