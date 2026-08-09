import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type WheelConfigRow = Database["public"]["Tables"]["wheel_configs"]["Row"]
export type WheelSlotRow = Database["public"]["Tables"]["wheel_slots"]["Row"]
export type UpsertWheelConfigArgs = Database["public"]["Tables"]["wheel_configs"]["Insert"]
export type UpsertWheelSlotArgs = Database["public"]["Tables"]["wheel_slots"]["Insert"]

/** The singleton wheel config row the BO edits. */
export const WHEEL_CONFIG_ID = "main"

/**
 * The singleton `wheel_configs` row. `maybeSingle` returns `null` when the
 * row doesn't exist yet (a legitimately empty config, not a failure), so
 * errors must surface but a missing row must not.
 */
export async function fetchWheelConfig(): Promise<WheelConfigRow | null> {
  if (!isAdminSupabaseConfigured) return null
  const {
    data,
    error,
  } = await adminSupabase
    .from("wheel_configs")
    .select("*")
    .eq("id", WHEEL_CONFIG_ID)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * All `wheel_slots` for the singleton config, in fixed wedge order. An
 * empty result (or an unconfigured Supabase) is a legitimately empty wheel,
 * not a failure.
 */
export async function fetchWheelSlots(): Promise<readonly WheelSlotRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("wheel_slots")
    .select("*")
    .eq("config_id", WHEEL_CONFIG_ID)
    .order("slot_index", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert the singleton wheel config, keyed by `id`. The payload carries the
 * full editable row so every field is preserved on conflict. The Supabase
 * error message is preserved verbatim so the caller can surface it to the
 * operator.
 */
export async function upsertWheelConfig(args: UpsertWheelConfigArgs): Promise<void> {
  const {error} = await adminSupabase
    .from("wheel_configs")
    .upsert(args, {onConflict: "id"})
  if (error) throw new Error(error.message)
}

/**
 * Upsert one wheel slot, keyed by `(config_id, slot_index)`. The payload
 * carries the full editable row so every field is preserved on conflict.
 * The Supabase error message is preserved verbatim so the caller can
 * surface it to the operator.
 */
export async function upsertWheelSlot(args: UpsertWheelSlotArgs): Promise<void> {
  const {error} = await adminSupabase
    .from("wheel_slots")
    .upsert(args, {onConflict: "config_id,slot_index"})
  if (error) throw new Error(error.message)
}
