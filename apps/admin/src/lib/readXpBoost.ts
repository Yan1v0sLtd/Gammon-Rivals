import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"

export function readXpBoost(text: string, field: "days" | "multiplier"): string {
  const grants = asShopJsonObject(parseShopContents(text).grants)
  const v = asShopJsonObject(grants.xpBoost)[field]
  return typeof v === "number" ? String(v) : ""
}
