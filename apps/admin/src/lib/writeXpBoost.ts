import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writeXpBoost(text: string, field: "days" | "multiplier", value: string): string {
  const c = parseShopContents(text)
  const grants = {...asShopJsonObject(c.grants)}
  const next = {...asShopJsonObject(grants.xpBoost)}
  const n = Number(value)
  if (value.trim() === "" || !Number.isFinite(n)) delete next[field]; else next[field] = Math.trunc(n)
  if (next.days === undefined && next.multiplier === undefined) delete grants.xpBoost; else grants.xpBoost = next
  return writeShopContents({
    ...c,
    grants,
  })
}
