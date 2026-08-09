import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writeGrantNumber(text: string, key: string, value: string): string {
  const c = parseShopContents(text)
  const grants = {...asShopJsonObject(c.grants)}
  const n = Number(value)
  if (value.trim() === "" || !Number.isFinite(n) || n === 0) delete grants[key]; else grants[key] = Math.trunc(n)
  return writeShopContents({
    ...c,
    grants,
  })
}
