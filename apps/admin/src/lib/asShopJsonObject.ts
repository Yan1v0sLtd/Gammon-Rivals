import type {Json} from "../../../../packages/shared/src/database"

export type ShopJsonObject = Record<string, Json>

export function asShopJsonObject(value: unknown): ShopJsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ShopJsonObject : {}
}
