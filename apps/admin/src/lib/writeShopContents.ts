import type {ShopJsonObject} from "./asShopJsonObject"

export function writeShopContents(obj: ShopJsonObject): string {
  return JSON.stringify(obj, null, 2)
}
