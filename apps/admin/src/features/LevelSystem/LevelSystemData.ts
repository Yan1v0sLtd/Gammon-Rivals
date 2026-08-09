import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"
import {isMissingColumnError} from "../../lib/isMissingColumnError"

export type LevelConfigRow = Database["public"]["Tables"]["level_configs"]["Row"]
export type LevelConfigInsert = Database["public"]["Tables"]["level_configs"]["Insert"]
export type LevelStatusTierRow = Database["public"]["Tables"]["level_status_tiers"]["Row"]
export type LevelStatusTierInsert = Database["public"]["Tables"]["level_status_tiers"]["Insert"]
export type LevelStatusTierUpdate = Database["public"]["Tables"]["level_status_tiers"]["Update"]

/** Batch size for the curve apply upsert — stays well under any URL/payload limit. */
const CURVE_UPSERT_BATCH = 50

/**
 * The full `level_configs` table, ordered by `level` — the gating fetch
 * that drives the Levels table + editor, so its errors must surface. An
 * empty result (or an unconfigured Supabase) is a legitimately empty
 * table, not a failure.
 */
export async function fetchLevelConfigs(): Promise<readonly LevelConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("level_configs")
    .select("*")
    .order("level", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * The full `level_status_tiers` table, ordered by `sort_order` then
 * `level_from` — the gating fetch that drives the Status Tiers panel, so
 * its errors must surface. An empty result (or an unconfigured Supabase)
 * is a legitimately empty table, not a failure.
 */
export async function fetchLevelStatusTiers(): Promise<readonly LevelStatusTierRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("level_status_tiers")
    .select("*")
    .order("sort_order", {ascending: true})
    .order("level_from", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Upsert one `level_configs` row, keyed by `level`. The payload carries
 * the full editable row (including `updated_by`, which the caller sets
 * from the operator identity) so every field is preserved on conflict.
 *
 * Legacy-schema fallback: the `status_label` column was dropped from the
 * live schema (status is now derived from `level_status_tiers`), but some
 * environments still carry it. If the upsert fails with a missing-column
 * error for `status_label`, retry once without that field so the save
 * still succeeds against the legacy schema. The Supabase error message is
 * preserved verbatim so the caller can surface it to the operator.
 */
export async function upsertLevelConfig(payload: LevelConfigInsert): Promise<void> {
  const {error} = await adminSupabase.from("level_configs").upsert(payload)
  if (isMissingColumnError(error, "status_label")) {
    const fallbackPayload = {...payload}
    delete fallbackPayload.status_label
    const fallback = await adminSupabase.from("level_configs").upsert(fallbackPayload)
    if (fallback.error) throw new Error(fallback.error.message)
  }
  else if (error) {
    throw new Error(error.message)
  }
}

/**
 * Delete `level_status_tiers` rows by id. Used by the tier save diff to
 * drop tiers the operator removed from the drafts.
 */
export async function deleteLevelStatusTiers(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const {error} = await adminSupabase
    .from("level_status_tiers")
    .delete()
    .in("id", ids)
  if (error) throw new Error(error.message)
}

/**
 * Insert new `level_status_tiers` rows. Each payload carries the full
 * editable row (including `updated_by`, which the caller sets from the
 * operator identity).
 */
export async function insertLevelStatusTiers(rows: readonly LevelStatusTierInsert[]): Promise<void> {
  if (rows.length === 0) return
  const {error} = await adminSupabase.from("level_status_tiers").insert([...rows])
  if (error) throw new Error(error.message)
}

/**
 * Update one `level_status_tiers` row by id. The tier table is small
 * (~10 rows max), so the tier save issues a per-row update rather than a
 * bulk RPC.
 */
export async function updateLevelStatusTier(id: string, patch: LevelStatusTierUpdate): Promise<void> {
  const {error} = await adminSupabase
    .from("level_status_tiers")
    .update(patch)
    .eq("id", id)
  if (error) throw new Error(error.message)
}

/**
 * Delete every `level_configs` row above `maxLevel` — the hard cap the
 * curve apply enforces so a stale high-level row from a previous
 * experiment can't keep gating players.
 */
export async function deleteLevelConfigsAboveCap(maxLevel: number): Promise<void> {
  const {error} = await adminSupabase
    .from("level_configs")
    .delete()
    .gt("level", maxLevel)
  if (error) throw new Error(error.message)
}

/**
 * Re-align every existing player's level to the current `level_configs`
 * thresholds. The auto-promote trigger only fires when a player EARNS xp,
 * so without this pass players stay frozen at their old level (and show a
 * broken XP bar) until their next match. Promote-only, no rewards — see
 * `recompute_player_levels()`. Returns the number of players re-leveled.
 */
export async function recomputePlayerLevels(): Promise<number> {
  const {
    data,
    error,
  } = await adminSupabase.rpc("recompute_player_levels")
  if (error) throw new Error(error.message)
  return data ?? 0
}

/**
 * Apply a proposed curve to `level_configs`: upsert the rows in batches
 * (keyed by `level`), drop any rows above the cap, then re-align existing
 * players via `recompute_player_levels`. Returns the number of players
 * re-leveled so the caller can report it.
 */
export async function applyLevelCurve(args: {
  rows: readonly LevelConfigInsert[],
  maxLevel: number,
}): Promise<number> {
  for (let i = 0; i < args.rows.length; i += CURVE_UPSERT_BATCH) {
    const slice = args.rows.slice(i, i + CURVE_UPSERT_BATCH)
    const {error} = await adminSupabase
      .from("level_configs")
      .upsert(slice, {onConflict: "level"})
    if (error) throw new Error(error.message)
  }
  await deleteLevelConfigsAboveCap(args.maxLevel)
  return recomputePlayerLevels()
}
