import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writeBoardGrant(text: string, value: string): string {
  const c = parseShopContents(text)
  const grants = {...asShopJsonObject(c.grants)}
  if (value.trim() === "") delete grants.boardThemeId; else grants.boardThemeId = value.trim()
  return writeShopContents({
    ...c,
    grants,
  })
}
