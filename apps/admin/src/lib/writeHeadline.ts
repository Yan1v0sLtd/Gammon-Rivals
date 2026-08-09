import {asShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"
import {writeShopContents} from "./writeShopContents"

export function writeHeadline(text: string, field: "kind" | "label" | "subLabel", value: string): string {
  const c = parseShopContents(text)
  const p = {...asShopJsonObject(c.presentation)}
  const h = {...asShopJsonObject(p.headline)}
  if (value.trim() === "") delete h[field]; else h[field] = value
  if (Object.keys(h).length === 0) delete p.headline; else p.headline = h
  return writeShopContents({
    ...c,
    presentation: p,
  })
}
