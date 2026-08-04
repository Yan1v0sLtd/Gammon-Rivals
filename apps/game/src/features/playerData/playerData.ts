import type {PostgrestError} from "@supabase/supabase-js"

import type {Database} from "../../../../../packages/shared/src/database"
import {supabase} from "../../lib/supabase"

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
export type UserWallet = Database["public"]["Tables"]["user_wallets"]["Row"]
export type LevelConfig = Database["public"]["Tables"]["level_configs"]["Row"]
export type LevelStatusTier = Database["public"]["Tables"]["level_status_tiers"]["Row"]

/**
 * Active XP boost summary shown in the lobby + applied by the server.
 * `multiplier` is the highest across all active boost rows (matches the
 * SQL helper); `expiresAt` is the matching row's expiry. We don't track
 * per-row data on the client — the audit trail lives in the DB.
 */
export type ActiveXpBoost = {
  readonly multiplier: number,
  readonly expiresAt: string,
}

/**
 * A freshly signed-in player may not have a profile/wallet row yet while
 * the DB provisioning trigger runs. Wait one 250 ms tick before giving
 * up, exactly once, and only when the query succeeded but found nothing.
 */
const PROVISION_RETRY_DELAY_MS = 250

async function maybeSingleWithProvisionRetry<T>(runQuery: () => PromiseLike<{
  data: T | null, error: PostgrestError | null,
}>): Promise<T | null> {
  let {
    data,
    error,
  } = await runQuery()
  if (!data && !error) {
    await new Promise((resolve) => setTimeout(resolve, PROVISION_RETRY_DELAY_MS));
    ({
      data,
      error,
    } = await runQuery())
  }
  if (error) throw error
  return data
}

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  return maybeSingleWithProvisionRetry(() => supabase.from("profiles").select("*").eq("id", userId).maybeSingle())
}

export async function fetchWallet(userId: string): Promise<UserWallet | null> {
  return maybeSingleWithProvisionRetry(() => supabase.from("user_wallets").select("*").eq("profile_id", userId).maybeSingle())
}

export async function fetchLevelConfigs(): Promise<LevelConfig[]> {
  const {
    data,
    error,
  } = await supabase
    .from("level_configs")
    .select("*")
    .order("level", {ascending: true})
  if (error) throw error
  return data ?? []
}

export async function fetchLevelStatusTiers(): Promise<LevelStatusTier[]> {
  const {
    data,
    error,
  } = await supabase
    .from("level_status_tiers")
    .select("*")
    .order("sort_order", {ascending: true})
    .order("level_from", {ascending: true})
  if (error) throw error
  return data ?? []
}

export async function fetchActiveXpBoost(userId: string): Promise<ActiveXpBoost | null> {
  const nowIso = new Date().toISOString()
  const {
    data,
    error,
  } = await supabase
    .from("user_xp_boosts")
    .select("multiplier, expires_at")
    .eq("profile_id", userId)
    .gt("expires_at", nowIso)
    .order("multiplier", {ascending: false})
    .order("expires_at", {ascending: false})
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? {
    multiplier: data.multiplier,
    expiresAt: data.expires_at,
  } : null
}

export async function updateDisplayName(userId: string, name: string): Promise<ProfileRow> {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error("name cannot be empty")
  const {
    data,
    error,
  } = await supabase
    .from("profiles")
    .update({display_name: trimmed})
    .eq("id", userId)
    .select()
    .single()
  if (error) throw error
  if (!data) throw new Error("Profile update returned no row.")
  return data
}
