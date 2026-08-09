import {asShopJsonObject, type ShopJsonObject} from "./asShopJsonObject"
import {parseShopContents} from "./parseShopContents"

export function readPres(text: string): ShopJsonObject {
  return asShopJsonObject(parseShopContents(text).presentation)
}
