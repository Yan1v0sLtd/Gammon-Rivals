import type {Database} from "../../../../packages/shared/src/database"

import {jsonToString} from "./jsonToString"

type DailyBonusConfig = Database["public"]["Tables"]["daily_bonus_configs"]["Row"]

export type DailyBonusDraft = {
  day: string, reward_coins: string, reward_gems: string, reward_xp: string, reward_items: string,
}

export function dailyBonusToDraft(row?: DailyBonusConfig): DailyBonusDraft {
  return {
    day: row?.day.toString() ?? "1",
    reward_coins: row?.reward_coins.toString() ?? "0",
    reward_gems: row?.reward_gems.toString() ?? "0",
    reward_xp: row?.reward_xp.toString() ?? "0",
    reward_items: jsonToString(row?.reward_items, "[]"),
  }
}
