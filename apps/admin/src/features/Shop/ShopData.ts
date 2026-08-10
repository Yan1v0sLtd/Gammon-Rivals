import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase as supabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type ShopItem = Database["public"]["Tables"]["shop_items"]["Row"]
export type SaleRow = Database["public"]["Tables"]["store_sales"]["Row"]
/** The storefront singleton, as selected below (title + background only). */
export type StoreConfigRow = {
  title: string,
  bg_image_url: string | null,
}

export type SaleDraft = {
  id: string | null,
  label: string,
  bonus_percent: string,
  is_active: boolean,
  starts_at: string,
  ends_at: string,
}

export type StoreConfigDraft = {
  title: string,
  bg_image_url: string,
}

export type UpsertShopItemPayload = Database["public"]["Tables"]["shop_items"]["Insert"]
export type UpsertStoreSalePayload = Omit<SaleRow, "id" | "created_at" | "updated_at">
export type UpsertStoreSaleArgs = {
  payload: UpsertStoreSalePayload,
  saleId: string | null,
}
export type UpsertStoreConfigPayload = Database["public"]["Tables"]["store_config"]["Insert"]

/** Map a persisted sale row back into the editor draft (the numeric bonus
 *  becomes a string so the input can be cleared mid-edit; datetimes are
 *  truncated to the minute for the datetime-local inputs). */
export function saleRowToDraft(s: SaleRow): SaleDraft {
  return {
    id: s.id,
    label: s.label,
    bonus_percent: String(s.bonus_percent),
    is_active: s.is_active,
    starts_at: s.starts_at?.slice(0, 16) ?? "",
    ends_at: s.ends_at?.slice(0, 16) ?? "",
  }
}

export function storeConfigRowToDraft(row: StoreConfigRow): StoreConfigDraft {
  return {
    title: row.title ?? "Store",
    bg_image_url: row.bg_image_url ?? "",
  }
}

/**
 * Shop items, ordered by the sort_order column — the same read the old
 * loadAdminData() did. Read guard: the section only mounts after the
 * access gate, so an unconfigured Supabase is an empty list, not a
 * failure.
 */
export async function fetchShopItems(): Promise<ShopItem[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await supabase.from("shop_items").select("*").order("sort_order", {ascending: true})
  if (error) throw error
  return data ?? []
}

/** The single global Store Sale row (latest by update). */
export async function fetchStoreSale(): Promise<SaleRow | null> {
  if (!isAdminSupabaseConfigured) return null
  const {
    data,
    error,
  } = await supabase
    .from("store_sales")
    .select("*")
    .order("updated_at", {ascending: false})
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** The storefront singleton row (seeded on migrate — always one row). */
export async function fetchStoreConfig(): Promise<StoreConfigRow | null> {
  if (!isAdminSupabaseConfigured) return null
  const {
    data,
    error,
  } = await supabase
    .from("store_config")
    .select("title, bg_image_url")
    .eq("id", true)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertShopItem(payload: UpsertShopItemPayload): Promise<void> {
  if (!isAdminSupabaseConfigured) return
  const {error} = await supabase.from("shop_items").upsert(payload)
  if (error) throw error
}

/** Update the existing sale row by id, or insert a fresh one when the
 *  draft has no id yet (a new sale). */
export async function upsertStoreSale({
  payload,
  saleId,
}: UpsertStoreSaleArgs): Promise<void> {
  if (!isAdminSupabaseConfigured) return
  const {error} = saleId ? await supabase.from("store_sales").update(payload).eq("id", saleId) : await supabase.from("store_sales").insert(payload)
  if (error) throw error
}

export async function upsertStoreConfig(payload: UpsertStoreConfigPayload): Promise<void> {
  if (!isAdminSupabaseConfigured) return
  const {error} = await supabase.from("store_config").upsert(payload, {onConflict: "id"})
  if (error) throw error
}

export async function deleteShopItem(id: string): Promise<void> {
  if (!isAdminSupabaseConfigured) return
  const {error} = await supabase.from("shop_items").delete().eq("id", id)
  if (error) throw error
}
