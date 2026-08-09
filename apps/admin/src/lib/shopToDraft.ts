import type {Database} from "../../../../packages/shared/src/database"

import {jsonToString} from "./jsonToString"

type ShopItem = Database["public"]["Tables"]["shop_items"]["Row"]
type ShopKind = ShopItem["kind"]

export type ShopDraft = {
  id: string,
  kind: ShopKind,
  display_name: string,
  description: string,
  image_url: string,
  price_cents: string,
  price_coins: string,
  price_gems: string,
  apple_product_id: string,
  google_product_id: string,
  contents: string,
  visibility_rules: string,
  starts_at: string,
  ends_at: string,
  max_purchases_per_user: string,
  is_enabled: boolean,
  exclude_from_sale: boolean,
  sort_order: string,
}

export function shopToDraft(row?: ShopItem): ShopDraft {
  return {
    id: row?.id ?? "",
    kind: row?.kind ?? "coin_pack",
    display_name: row?.display_name ?? "",
    description: row?.description ?? "",
    image_url: row?.image_url ?? "",
    price_cents: row?.price_cents?.toString() ?? "",
    price_coins: row?.price_coins?.toString() ?? "",
    price_gems: row?.price_gems?.toString() ?? "",
    apple_product_id: row?.apple_product_id ?? "",
    google_product_id: row?.google_product_id ?? "",
    contents: jsonToString(row?.contents, "{}"),
    visibility_rules: jsonToString(row?.visibility_rules, "{}"),
    starts_at: row?.starts_at?.slice(0, 16) ?? "",
    ends_at: row?.ends_at?.slice(0, 16) ?? "",
    max_purchases_per_user: row?.max_purchases_per_user?.toString() ?? "",
    is_enabled: row?.is_enabled ?? false,
    exclude_from_sale: row?.exclude_from_sale ?? false,
    sort_order: row?.sort_order.toString() ?? "0",
  }
}
