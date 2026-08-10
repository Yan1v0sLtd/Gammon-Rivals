import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export type LobbyFeatureConfigRow = Database["public"]["Tables"]["lobby_feature_configs"]["Row"]

/** The editable subset of a lobby feature config row, as selected by the fetch. */
export type LobbyFeatureConfig = Pick<LobbyFeatureConfigRow, "feature_key" | "label" | "unlock_level" | "is_enabled" | "sort_order" | "tooltip_text">

/**
 * The full lobby feature config table, ordered by `sort_order` — the gating
 * fetch that drives the Lobby Features section's list + edit form, so its
 * errors must surface. An empty result (or an unconfigured Supabase) is a
 * legitimately empty table, not a failure.
 */
export async function fetchLobbyFeatures(): Promise<readonly LobbyFeatureConfig[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("lobby_feature_configs")
    .select("feature_key, label, unlock_level, is_enabled, sort_order, tooltip_text")
    .order("sort_order", {ascending: true})
  if (error) throw error
  return data ?? []
}

/**
 * Update the editable fields of one lobby feature config, keyed by
 * `feature_key`. Returns the updated row so the caller can refresh its
 * view-model without a refetch. The Supabase error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function updateLobbyFeature(featureKey: string, patch: Pick<LobbyFeatureConfigRow, "unlock_level" | "is_enabled" | "tooltip_text">): Promise<LobbyFeatureConfig> {
  const {
    data,
    error,
  } = await adminSupabase
    .from("lobby_feature_configs")
    .update(patch)
    .eq("feature_key", featureKey)
    .select("feature_key, label, unlock_level, is_enabled, sort_order, tooltip_text")
    .single()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No lobby feature config found for feature_key "${featureKey}".`)
  return data
}
