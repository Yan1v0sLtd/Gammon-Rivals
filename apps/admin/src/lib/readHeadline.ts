import {asShopJsonObject} from "./asShopJsonObject"
import {readPres} from "./readPres"

export function readHeadline(text: string, field: "kind" | "label" | "subLabel"): string {
  const v = asShopJsonObject(readPres(text).headline)[field]
  return typeof v === "string" ? v : ""
}
