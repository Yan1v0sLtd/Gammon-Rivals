import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type EconomyGrantRow = Database["public"]["Tables"]["economy_grants"]["Row"]
export type UpsertEconomyGrantArgs = Database["public"]["Functions"]["admin_upsert_economy_grant"]["Args"]

/**
 * The full economy grants table, ordered by `sort_order` then `trigger_key` —
 * the gating fetch that drives the Economy Grants section's list + edit form,
 * so its errors must surface. An empty result (or an unconfigured Supabase) is
 * a legitimately empty table, not a failure.
 */
export async function fetchEconomyGrants(): Promise<readonly EconomyGrantRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("economy_grants")
    .select("*")
    .order("sort_order", {ascending: true})
    .order("trigger_key", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert an economy grant. The RPC's error message is preserved verbatim so
 * the caller can surface it to the operator.
 */
export async function upsertEconomyGrant(args: UpsertEconomyGrantArgs): Promise<void> {
  const {error} = await adminSupabase.rpc("admin_upsert_economy_grant", args)
  if (error) throw new Error(error.message)
}
