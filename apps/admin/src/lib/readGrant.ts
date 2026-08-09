import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"

export function readGrant(text: string, key: string): string {
  const v = asShopJsonObject(parseShopContents(text).grants)[key]
  return typeof v === "number" ? String(v) : ""
}
