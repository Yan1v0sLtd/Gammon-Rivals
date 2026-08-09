import {asShopJsonObject} from "./asShopJsonObject"
import {readPres} from "./readPres"

export function readHeader(text: string, field: "text" | "bg" | "fg"): string {
  const v = asShopJsonObject(readPres(text).header)[field]
  return typeof v === "string" ? v : ""
}
