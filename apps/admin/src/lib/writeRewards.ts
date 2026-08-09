import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import type {ShopReward} from "./readRewards"
import {writeShopContents} from "./writeShopContents"

export function writeRewards(text: string, rewards: ShopReward[]): string {
  const c = parseShopContents(text)
  const p = {...asShopJsonObject(c.presentation)}
  if (rewards.length === 0) delete p.rewards; else p.rewards = rewards.map(({
    kind,
    label,
  }) => ({
    kind,
    label,
  }))
  return writeShopContents({
    ...c,
    presentation: p,
  })
}
