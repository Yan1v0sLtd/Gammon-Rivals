import {asShopJsonObject} from "./asShopJsonObject"
import {readPres} from "./readPres"

export type ShopReward = {
  kind: string,
  label: string,
}

export function readRewards(text: string): ShopReward[] {
  const rewards = readPres(text).rewards
  return Array.isArray(rewards) ? rewards.map((value) => {
    const reward = asShopJsonObject(value)
    return {
      kind: typeof reward.kind === "string" ? reward.kind : "coins",
      label: typeof reward.label === "string" ? reward.label : "",
    }
  }) : []
}
