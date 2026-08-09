import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writeHeader(text: string, field: "text" | "bg" | "fg", value: string): string {
  const c = parseShopContents(text)
  const p = {...asShopJsonObject(c.presentation)}
  const h = {...asShopJsonObject(p.header)}
  if (value.trim() === "") delete h[field]; else h[field] = value
  if (Object.keys(h).length === 0) delete p.header; else p.header = h
  return writeShopContents({
    ...c,
    presentation: p,
  })
}
