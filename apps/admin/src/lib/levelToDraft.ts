import type {Database} from "../../../../packages/shared/src/database"

import {jsonToString} from "./jsonToString"

type LevelConfig = Database["public"]["Tables"]["level_configs"]["Row"]

export type LevelDraft = {
  level: string,
  xp_required: string,
  status_label: string,
  reward_coins: string,
  reward_gems: string,
  reward_items: string,
  unlock_rules: string,
  is_enabled: boolean,
}

export function levelToDraft(row?: LevelConfig): LevelDraft {
  return {
    level: row?.level.toString() ?? "",
    xp_required: row?.xp_required.toString() ?? "0",
    status_label: row?.status_label ?? "Rookie",
    reward_coins: row?.reward_coins.toString() ?? "0",
    reward_gems: row?.reward_gems.toString() ?? "0",
    reward_items: jsonToString(row?.reward_items, "[]"),
    unlock_rules: jsonToString(row?.unlock_rules, "{}"),
    is_enabled: row?.is_enabled ?? true,
  }
}
