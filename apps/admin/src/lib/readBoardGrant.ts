import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"

export function readBoardGrant(text: string): string {
  const v = asShopJsonObject(parseShopContents(text).grants).boardThemeId
  return typeof v === "string" ? v : ""
}
