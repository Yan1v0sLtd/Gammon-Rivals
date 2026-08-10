import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type BoardThemeConfigRow = Database["public"]["Tables"]["board_theme_configs"]["Row"]
export type BoardThemeConfigInsert = Database["public"]["Tables"]["board_theme_configs"]["Insert"]
export type PodiumImageRow = Database["public"]["Tables"]["podium_images"]["Row"]
export type PodiumImageInsert = Database["public"]["Tables"]["podium_images"]["Insert"]
export type LoadingScreenImageRow = Database["public"]["Tables"]["loading_screen_images"]["Row"]
export type LoadingScreenImageInsert = Database["public"]["Tables"]["loading_screen_images"]["Insert"]

/**
 * All `board_theme_configs` rows, ordered by `sort_order` — the gating
 * fetch that drives the Board Themes grid and the Dashboard's "Game
 * config" count, so its errors must surface. An empty result (or an
 * unconfigured Supabase) is a legitimately empty table, not a failure.
 */
export async function fetchBoards(): Promise<readonly BoardThemeConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("board_theme_configs")
    .select("*")
    .order("sort_order", {ascending: true})
  if (error) throw error
  return data ?? []
}

export async function upsertBoard(payload: BoardThemeConfigInsert): Promise<void> {
  const {error} = await adminSupabase
    .from("board_theme_configs")
    .upsert(payload, {onConflict: "id"})
  if (error) throw error
}

export async function deleteBoard(id: string): Promise<void> {
  const {error} = await adminSupabase
    .from("board_theme_configs")
    .delete()
    .eq("id", id)
  if (error) throw error
}

/** Bulk upsert of the built-in seed rows (Populate Current Boards). */
export async function seedBoards(payloads: readonly BoardThemeConfigInsert[]): Promise<void> {
  const {error} = await adminSupabase
    .from("board_theme_configs")
    .upsert([...payloads], {onConflict: "id"})
  if (error) throw error
}

/**
 * The podium library — newest first (sort_order desc, then created_at
 * desc). Newest-first matches the lobby carousel ordering, which the old
 * admin read mirrored. Loaded lazily when the Board Themes section opens.
 */
export async function fetchPodiums(): Promise<readonly PodiumImageRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("podium_images")
    .select("*")
    .order("sort_order", {ascending: false})
    .order("created_at", {ascending: false})
  if (error) throw error
  return data ?? []
}

export async function addPodium(payload: PodiumImageInsert): Promise<void> {
  const {error} = await adminSupabase.from("podium_images").insert(payload)
  if (error) throw error
}

export async function activatePodium(id: string): Promise<void> {
  const {error} = await adminSupabase.rpc("set_active_podium", {p_id: id})
  if (error) throw error
}

export async function deletePodium(id: string): Promise<void> {
  const {error} = await adminSupabase.from("podium_images").delete().eq("id", id)
  if (error) throw error
}

/**
 * The loading-screen library — same model as the podium (many rows,
 * exactly one active). Same ordering as the podium read.
 */
export async function fetchLoadingScreens(): Promise<readonly LoadingScreenImageRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("loading_screen_images")
    .select("*")
    .order("sort_order", {ascending: false})
    .order("created_at", {ascending: false})
  if (error) throw error
  return data ?? []
}

export async function addLoadingScreen(payload: LoadingScreenImageInsert): Promise<void> {
  const {error} = await adminSupabase.from("loading_screen_images").insert(payload)
  if (error) throw error
}

export async function activateLoadingScreen(id: string): Promise<void> {
  const {error} = await adminSupabase.rpc("set_active_loading_screen", {p_id: id})
  if (error) throw error
}

export async function deleteLoadingScreen(id: string): Promise<void> {
  const {error} = await adminSupabase.from("loading_screen_images").delete().eq("id", id)
  if (error) throw error
}
