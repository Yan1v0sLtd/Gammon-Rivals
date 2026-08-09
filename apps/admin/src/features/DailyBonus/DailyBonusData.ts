import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type DailyBonusConfigRow = Database["public"]["Tables"]["daily_bonus_configs"]["Row"]
export type UpsertDailyBonusConfigArgs = Database["public"]["Tables"]["daily_bonus_configs"]["Insert"]

/**
 * The full daily bonus config table, ordered by `day` — the gating fetch
 * that drives the Daily Bonus section's list + edit form, so its errors
 * must surface. An empty result (or an unconfigured Supabase) is a
 * legitimately empty table, not a failure.
 */
export async function fetchDailyBonusConfigs(): Promise<readonly DailyBonusConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("daily_bonus_configs")
    .select("*")
    .order("day", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert one daily bonus config, keyed by `day`. The payload carries the
 * full editable row (including `updated_by`, which the caller sets from the
 * operator identity) so every field is preserved on conflict. The Supabase
 * error message is preserved verbatim so the caller can surface it to the
 * operator.
 */
export async function upsertDailyBonusConfig(args: UpsertDailyBonusConfigArgs): Promise<void> {
  const {error} = await adminSupabase
    .from("daily_bonus_configs")
    .upsert(args, {onConflict: "day"})
  if (error) throw new Error(error.message)
}
