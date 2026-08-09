import {asShopJsonObject, type ShopJsonObject} from "./asShopJsonObject"

export function parseShopContents(text: string): ShopJsonObject {
  try {
    return asShopJsonObject(JSON.parse(text))
  }
  catch {
    return {}
  }
}
