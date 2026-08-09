import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writePresField(text: string, key: string, value: string): string {
  const c = parseShopContents(text)
  const p = {...asShopJsonObject(c.presentation)}
  if (value.trim() === "" || value === "none") delete p[key]; else p[key] = value
  return writeShopContents({
    ...c,
    presentation: p,
  })
}
