import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type CurrencyConfigRow = Database["public"]["Tables"]["currency_configs"]["Row"]
export type UpsertCurrencyConfigArgs = Database["public"]["Functions"]["admin_upsert_currency_config"]["Args"]

/**
 * The full currency config table, ordered by `sort_order` — the gating
 * fetch that drives the Currencies section's list + edit form, so its
 * errors must surface. An empty result (or an unconfigured Supabase) is
 * a legitimately empty table, not a failure.
 */
export async function fetchCurrencies(): Promise<readonly CurrencyConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("currency_configs")
    .select("*")
    .order("sort_order", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert a currency config. The RPC's error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function upsertCurrencyConfig(args: UpsertCurrencyConfigArgs): Promise<void> {
  const {error} = await adminSupabase.rpc("admin_upsert_currency_config", args)
  if (error) throw new Error(error.message)
}
