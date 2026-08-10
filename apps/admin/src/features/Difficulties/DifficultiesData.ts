import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type TableConfigRow = Database["public"]["Tables"]["table_configs"]["Row"]
export type TableConfigInsert = Database["public"]["Tables"]["table_configs"]["Insert"]

/**
 * The full `table_configs` table, ordered by `sort_order` — the gating
 * fetch that drives the Difficulty tiers list and the Dashboard's "Game
 * config" count, so its errors must surface. An empty result (or an
 * unconfigured Supabase) is a legitimately empty table, not a failure.
 */
export async function fetchTables(): Promise<readonly TableConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("table_configs")
    .select("*")
    .order("sort_order", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert one `table_configs` row, keyed by `id`. The payload carries the
 * full editable row (including `updated_by`, which the caller sets from
 * the operator identity) so every field is preserved on conflict.
 */
export async function upsertTable(payload: TableConfigInsert): Promise<void> {
  const {error} = await adminSupabase.from("table_configs").upsert(payload)
  if (error) throw error
}
