import type {SupabaseClient} from "@supabase/supabase-js"

import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

/* ────────────────────────────────────────────────────────────────── */
/* Local row / insert / update types                                  */
/*                                                                   */
/* The Daily Missions tables aren't in the generated `Database` type  */
/* (a full Supabase types regen would lose the project's hand-patched */
/* phantom columns — see the MissionsAdmin.tsx header note). We       */
/* define narrow local interfaces from the schema migrations and the  */
/* component's queries instead of widening to `any`.                  */
/* ────────────────────────────────────────────────────────────────── */

export type MissionTemplateRow = {
  id: string,
  mission_type: string,
  metric_code: string,
  rarity: "common" | "rare" | "epic",
  resolution_mode: "fixed" | "stretch" | "personalized",
  goal_value: number | null,
  stretch_factor: number | null,
  goal_min: number,
  goal_max: number,
  eligibility: Record<string, unknown>,
  params: Record<string, unknown>,
  mission_points: number,
  period: "daily" | "weekly",
  title: string,
  subtitle: string | null,
  icon_url: string | null,
  enabled: boolean,
  reward_mode: "manual" | "cashback",
  cashback_pct: number | null,
  created_at: string,
  updated_at: string,
}

export type MissionTemplateInsert = Omit<MissionTemplateRow, "id" | "created_at" | "updated_at">
export type MissionTemplateUpdate = Partial<MissionTemplateInsert>

export type MissionRewardRow = {
  id: string,
  mission_id: string,
  reward_kind: "currency" | "item",
  currency_code: string | null,
  item_table: string | null,
  item_id: string | null,
  amount: number,
  display_order: number,
  created_at: string,
}

export type MissionRewardInsert = Omit<MissionRewardRow, "id" | "created_at">

/** Reward rows for a mission template being created/edited, authored
 *  without a `mission_id` — the caller cannot know the template id until
 *  it has been inserted. `saveMissionTemplate` injects the resolved id
 *  immediately before writing. */
export type MissionRewardDraft = Omit<MissionRewardRow, "id" | "created_at" | "mission_id">

export type MissionTypeConfigRow = {
  mission_type: string,
  metric_code: string,
  label: string,
  description: string | null,
  is_wired: boolean,
  supports_personalized: boolean,
  base_stretch: number,
  up_step: number,
  ease_after: number,
  ease_factor: number,
  floor_mult: number,
  cap_mult: number,
  reward_pct: number,
  floor_reward: number,
  round_to: number,
  baseline_window_days: number,
  goal_round_to: number,
  rollout_pct: number,
  created_at: string,
  updated_at: string,
}

/** The operator-editable coefficient fields (metric_code + is_wired are
 *  code-derived truth, intentionally excluded from the update). */
export type MissionTypeConfigUpdate = {
  label: string,
  description: string | null,
  supports_personalized: boolean,
  base_stretch: number,
  up_step: number,
  ease_after: number,
  ease_factor: number,
  floor_mult: number,
  cap_mult: number,
  reward_pct: number,
  floor_reward: number,
  round_to: number,
  baseline_window_days: number,
  goal_round_to: number,
  rollout_pct: number,
}

export type ChestMilestoneRow = {
  id: string,
  milestone_index: number,
  threshold_mp: number,
  display_name: string,
  rarity: string,
  enabled: boolean,
  created_at: string,
  updated_at: string,
}

export type ChestMilestoneUpdate = Omit<ChestMilestoneRow, "id" | "created_at" | "updated_at">

export type ChestRewardRow = {
  id: string,
  milestone_id: string,
  reward_kind: "currency" | "item",
  currency_code: string | null,
  item_table: string | null,
  item_id: string | null,
  amount: number,
  display_order: number,
  created_at: string,
}

export type ChestRewardInsert = Omit<ChestRewardRow, "id" | "created_at">

export type RerollPricingConfigRow = {
  id: string,
  gem_cost_ladder: number[],
  daily_cap: number,
  updated_at: string,
}

export type RerollPricingConfigUpdate = {
  gem_cost_ladder: number[],
  daily_cap: number,
}

export type StreakChestRewardRow = {
  id: string,
  reward_kind: "currency" | "item",
  currency_code: string | null,
  item_table: string | null,
  item_id: string | null,
  amount: number,
  display_order: number,
  created_at: string,
}

export type StreakChestRewardInsert = Omit<StreakChestRewardRow, "id" | "created_at">

/* ────────────────────────────────────────────────────────────────── */
/* RPC result shapes                                                  */
/* ────────────────────────────────────────────────────────────────── */

/** `admin_refresh_player_missions` — clears a real player's current daily
 *  missions and re-runs the assigner. Returns counts of what was cleared
 *  and assigned (plus the resolved profile id). */
export type RefreshPlayerMissionsResult = {
  profile_id: string,
  deleted: number,
  assigned: number,
}

export type SimTestProfileSummary = {
  id: string,
  display_name: string,
  level: number,
  pvp_rating: number,
  created_at: string,
}

export type SimTestUserState = {
  profile: {id: string, display_name: string, level: number, xp: number, pvp_rating: number},
  metrics: readonly {metric_code: string, baseline_7d: number, tier: string | null}[],
  missions: readonly {
    id: string,
    title: string,
    rarity: string,
    period: string,
    mission_type: string,
    metric_code: string,
    resolution_mode: string,
    resolved_goal: number,
    mission_points: number,
    rewards: readonly {currency_code: string | null, amount: number}[],
  }[],
}

export type SimSpawnResult = {
  casuals: number,
  regulars: number,
  whales: number,
}

/* ────────────────────────────────────────────────────────────────── */
/* Singleton ids / constants                                          */
/* ────────────────────────────────────────────────────────────────── */

/** The singleton `reroll_pricing_config` row id. */
export const REROLL_CONFIG_ID = "default"

/** Thrown before any write/delete/update/simulator call when Supabase is
 *  unconfigured, so the operator sees a clear config error instead of a
 *  confusing proxy failure. Mirrors the message the missing-client proxy
 *  throws (see `lib/adminSupabase.ts`). */
const MISSING_CONFIG_MESSAGE = "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use the back office."

/** The zero-uuid row kept in `streak_chest_rewards` on replace (the delete
 *  guard excludes it so the singleton bundle is fully replaced, never
 *  accidentally nuked by a stray id). */
export const STREAK_CHEST_KEEP_ID = "00000000-0000-0000-0000-000000000000"

/* ────────────────────────────────────────────────────────────────── */
/* Typed client for the Daily Missions tables                         */
/*                                                                   */
/* `adminSupabase` is typed against the generated `Database`, which   */
/* lacks these tables. We cast it to a client whose schema adds the   */
/* Daily Missions tables (and the admin refresh RPC) so every call    */
/* stays type-checked — no `any`.                                     */
/* ────────────────────────────────────────────────────────────────── */

type DailyMissionsDatabase = {
  public: {
    Tables: {
      mission_templates: {
        Row: MissionTemplateRow,
        Insert: MissionTemplateInsert,
        Update: MissionTemplateUpdate,
        Relationships: [],
      },
      mission_rewards: {
        Row: MissionRewardRow,
        Insert: MissionRewardInsert,
        Update: Partial<MissionRewardInsert>,
        Relationships: [],
      },
      mission_type_config: {
        Row: MissionTypeConfigRow,
        Insert: MissionTypeConfigRow,
        Update: MissionTypeConfigUpdate,
        Relationships: [],
      },
      chest_milestones: {
        Row: ChestMilestoneRow,
        Insert: ChestMilestoneRow,
        Update: ChestMilestoneUpdate,
        Relationships: [],
      },
      chest_rewards: {
        Row: ChestRewardRow,
        Insert: ChestRewardInsert,
        Update: Partial<ChestRewardInsert>,
        Relationships: [],
      },
      reroll_pricing_config: {
        Row: RerollPricingConfigRow,
        Insert: RerollPricingConfigRow,
        Update: RerollPricingConfigUpdate,
        Relationships: [],
      },
      streak_chest_rewards: {
        Row: StreakChestRewardRow,
        Insert: StreakChestRewardInsert,
        Update: Partial<StreakChestRewardInsert>,
        Relationships: [],
      },
    },
    Views: Record<never, never>,
    Functions: Database["public"]["Functions"] & {
      admin_refresh_player_missions: {
        Args: {p_email: string},
        Returns: RefreshPlayerMissionsResult,
      },
    },
    Enums: Record<never, never>,
    CompositeTypes: Record<never, never>,
  },
}

const sb = adminSupabase as unknown as SupabaseClient<DailyMissionsDatabase>

/* ────────────────────────────────────────────────────────────────── */
/* Mission templates + reward bundles                                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * The full `mission_type_config` registry, ordered by `label` — the
 * gating fetch that drives the Templates editor's type dropdown, so its
 * errors must surface. An empty result (or an unconfigured Supabase) is
 * a legitimately empty registry, not a failure.
 */
export async function fetchMissionTypeConfigs(): Promise<readonly MissionTypeConfigRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("mission_type_config").select("*").order("label")
  if (error) throw error
  return data ?? []
}

/**
 * The full `mission_templates` catalog, ordered by `period`, `rarity`,
 * then `mission_type` — the gating fetch that drives the Templates list,
 * so its errors must surface. An empty result (or an unconfigured
 * Supabase) is a legitimately empty catalog, not a failure.
 */
export async function fetchMissionTemplates(): Promise<readonly MissionTemplateRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("mission_templates")
    .select("*")
    .order("period")
    .order("rarity")
    .order("mission_type")
  if (error) throw error
  return data ?? []
}

/**
 * Every `mission_rewards` row, ordered by `display_order`. The caller
 * groups them by `mission_id` for the per-template bundle. An empty
 * result (or an unconfigured Supabase) is a legitimately empty set, not
 * a failure.
 */
export async function fetchMissionRewards(): Promise<readonly MissionRewardRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("mission_rewards").select("*").order("display_order")
  if (error) throw error
  return data ?? []
}

/**
 * Save a mission template and its reward bundle as an ordered, multi-step,
 * non-atomic sequence: update-or-insert the template (returning its id),
 * then delete the existing rewards, then insert the replacement rewards.
 * Rewards arrive as drafts without a `mission_id` (unknown until the
 * template id resolves), so it is injected here immediately before the
 * insert. Each step is a separate write, so a failure partway through can
 * leave the parent saved without its new rewards. The Supabase error
 * message is preserved verbatim so the caller can surface it to the
 * operator.
 */
export async function saveMissionTemplate(args: {
  id: string | null,
  payload: MissionTemplateInsert,
  rewards: readonly MissionRewardDraft[],
}): Promise<string> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  let templateId: string
  if (args.id) {
    const {error} = await sb.from("mission_templates").update(args.payload).eq("id", args.id)
    if (error) throw new Error(error.message)
    templateId = args.id
  }
  else {
    const {
      data,
      error,
    } = await sb.from("mission_templates").insert(args.payload).select("id").single()
    if (error) throw new Error(error.message)
    templateId = data.id
  }

  const {error: delErr} = await sb.from("mission_rewards").delete().eq("mission_id", templateId)
  if (delErr) throw new Error(delErr.message)

  if (args.rewards.length > 0) {
    const {error: insErr} = await sb.from("mission_rewards").insert(
      args.rewards.map((r) => ({...r, mission_id: templateId})),
    )
    if (insErr) throw new Error(insErr.message)
  }

  return templateId
}

/**
 * Delete a mission template by id. Its reward rows cascade via the
 * `mission_rewards.mission_id` FK. The Supabase error message is
 * preserved verbatim so the caller can surface it to the operator.
 */
export async function deleteMissionTemplate(id: string): Promise<void> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {error} = await sb.from("mission_templates").delete().eq("id", id)
  if (error) throw new Error(error.message)
}

/* ────────────────────────────────────────────────────────────────── */
/* Mission type registry                                              */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Update one `mission_type_config` row by its `mission_type` primary key.
 * Only the operator-editable coefficient fields are written; `metric_code`
 * and `is_wired` are code-derived truth and stay untouched. The Supabase
 * error message is preserved verbatim so the caller can surface it to the
 * operator.
 */
export async function updateMissionTypeConfig(missionType: string, patch: MissionTypeConfigUpdate): Promise<void> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {error} = await sb.from("mission_type_config").update(patch).eq("mission_type", missionType)
  if (error) throw new Error(error.message)
}

/* ────────────────────────────────────────────────────────────────── */
/* Chest milestones + reward bundles                                  */
/* ────────────────────────────────────────────────────────────────── */

/**
 * The full `chest_milestones` table, ordered by `milestone_index` — the
 * gating fetch that drives the Chests editor, so its errors must surface.
 * An empty result (or an unconfigured Supabase) is a legitimately empty
 * set, not a failure.
 */
export async function fetchChestMilestones(): Promise<readonly ChestMilestoneRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("chest_milestones").select("*").order("milestone_index")
  if (error) throw error
  return data ?? []
}

/**
 * Every `chest_rewards` row, ordered by `display_order`. The caller
 * groups them by `milestone_id` for the per-chest bundle. An empty result
 * (or an unconfigured Supabase) is a legitimately empty set, not a
 * failure.
 */
export async function fetchChestRewards(): Promise<readonly ChestRewardRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("chest_rewards").select("*").order("display_order")
  if (error) throw error
  return data ?? []
}

/**
 * Save a chest milestone and its reward bundle as an ordered, multi-step,
 * non-atomic sequence: update the milestone by id, then delete the existing
 * rewards, then insert the replacement rewards. Each step is a separate
 * write, so a failure partway through can leave the parent saved without
 * its new rewards. The Supabase error message is preserved verbatim so the
 * caller can surface it to the operator.
 */
export async function saveChestMilestone(args: {
  id: string,
  patch: ChestMilestoneUpdate,
  rewards: readonly ChestRewardInsert[],
}): Promise<void> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {error} = await sb.from("chest_milestones").update(args.patch).eq("id", args.id)
  if (error) throw new Error(error.message)

  const {error: delErr} = await sb.from("chest_rewards").delete().eq("milestone_id", args.id)
  if (delErr) throw new Error(delErr.message)

  if (args.rewards.length > 0) {
    const {error: insErr} = await sb.from("chest_rewards").insert([...args.rewards])
    if (insErr) throw new Error(insErr.message)
  }
}

/* ────────────────────────────────────────────────────────────────── */
/* Reroll pricing singleton                                           */
/* ────────────────────────────────────────────────────────────────── */

/**
 * The singleton `reroll_pricing_config` row. `single` throws when the row
 * is missing, which is correct here — the row is always seeded. An
 * unconfigured Supabase returns `null` so the caller can render an empty
 * editor rather than erroring.
 */
export async function fetchRerollPricingConfig(): Promise<RerollPricingConfigRow | null> {
  if (!isAdminSupabaseConfigured) return null
  const {
    data,
    error,
  } = await sb.from("reroll_pricing_config").select("*").eq("id", REROLL_CONFIG_ID).single()
  if (error) throw error
  return data
}

/**
 * Update the singleton `reroll_pricing_config` row (ladder + daily cap).
 * The Supabase error message is preserved verbatim so the caller can
 * surface it to the operator.
 */
export async function updateRerollPricingConfig(patch: RerollPricingConfigUpdate): Promise<void> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {error} = await sb.from("reroll_pricing_config").update(patch).eq("id", REROLL_CONFIG_ID)
  if (error) throw new Error(error.message)
}

/* ────────────────────────────────────────────────────────────────── */
/* Streak chest rewards                                               */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Every `streak_chest_rewards` row, ordered by `display_order` — the
 * gating fetch that drives the Streak Chest editor, so its errors must
 * surface. An empty result (or an unconfigured Supabase) is a
 * legitimately empty bundle, not a failure.
 */
export async function fetchStreakChestRewards(): Promise<readonly StreakChestRewardRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.from("streak_chest_rewards").select("*").order("display_order")
  if (error) throw error
  return data ?? []
}

/**
 * Replace the streak chest bundle as an ordered, multi-step, non-atomic
 * sequence: delete every row except the zero-uuid sentinel, then re-insert
 * the authored rows. Each step is a separate write, so a failure partway
 * through can leave the bundle partially replaced. The delete guard
 * preserves the singleton shape. The Supabase error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function saveStreakChestRewards(rows: readonly StreakChestRewardInsert[]): Promise<void> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {error: delErr} = await sb.from("streak_chest_rewards").delete().neq("id", STREAK_CHEST_KEEP_ID)
  if (delErr) throw new Error(delErr.message)

  if (rows.length > 0) {
    const {error: insErr} = await sb.from("streak_chest_rewards").insert([...rows])
    if (insErr) throw new Error(insErr.message)
  }
}

/* ────────────────────────────────────────────────────────────────── */
/* Player mission refresh (BO testing helper)                         */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Refresh a real player's daily missions on demand (clears current daily
 * slots and re-runs the assigner). Weekly missions are left intact. The
 * RPC's error message is preserved verbatim so the caller can surface it
 * to the operator.
 */
export async function refreshPlayerMissions(email: string): Promise<RefreshPlayerMissionsResult> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("admin_refresh_player_missions", {p_email: email})
  if (error) throw error
  return data
}

/* ────────────────────────────────────────────────────────────────── */
/* Simulator RPCs                                                     */
/* ────────────────────────────────────────────────────────────────── */

/**
 * List the synthetic test profiles, newest first. An empty result (or an
 * unconfigured Supabase) is a legitimately empty set, not a failure.
 */
export async function listSimTestProfiles(): Promise<readonly SimTestProfileSummary[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await sb.rpc("simulate_list_test_profiles")
  if (error) throw error
  return (data ?? []) as unknown as SimTestProfileSummary[]
}

/**
 * Fetch the full state (profile, metric baselines, active missions) for a
 * synthetic test profile. An unconfigured Supabase returns an empty state
 * so the caller can render an empty detail pane rather than erroring.
 */
export async function getSimTestUserState(profileId: string): Promise<SimTestUserState> {
  if (!isAdminSupabaseConfigured) return EMPTY_SIM_STATE
  const {
    data,
    error,
  } = await sb.rpc("simulate_get_test_user_state", {p_profile_id: profileId})
  if (error) throw error
  return data as unknown as SimTestUserState
}

const EMPTY_SIM_STATE: SimTestUserState = {
  profile: {id: "", display_name: "", level: 0, xp: 0, pvp_rating: 0},
  metrics: [],
  missions: [],
}

/**
 * Create a synthetic test profile. Returns the new profile id so the
 * caller can select it immediately. The RPC's error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function createSimTestProfile(args: {
  displayName: string,
  level: number,
  pvpRating: number,
}): Promise<string> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("simulate_create_test_profile", {
    p_display_name: args.displayName,
    p_level: args.level,
    p_pvp_rating: args.pvpRating,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Set a synthetic profile's metric baseline (and derive its tier). The
 * RPC's error message is preserved verbatim so the caller can surface it
 * to the operator.
 */
export async function setSimMetric(args: {
  profileId: string,
  metricCode: string,
  baseline: number,
}): Promise<string> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("simulate_set_metric", {
    p_profile_id: args.profileId,
    p_metric_code: args.metricCode,
    p_baseline: args.baseline,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Clear a synthetic profile's current missions. Returns the number of
 * rows deleted. The RPC's error message is preserved verbatim so the
 * caller can surface it to the operator.
 */
export async function resetSimTodayMissions(profileId: string): Promise<number> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("simulate_reset_today_missions", {p_profile_id: profileId})
  if (error) throw new Error(error.message)
  return data ?? 0
}

/**
 * Re-run the daily mission assigner for a synthetic profile. Returns the
 * number of missions assigned. The RPC's error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function assignSimDailyMissions(profileId: string): Promise<number> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("assign_daily_missions_for_profile", {p_profile_id: profileId})
  if (error) throw new Error(error.message)
  return data ?? 0
}

/**
 * Spawn synthetic archetype profiles in bulk (casuals / regulars /
 * whales), assign missions, and recompute metrics. Returns the counts
 * spawned. The RPC's error message is preserved verbatim so the caller
 * can surface it to the operator.
 */
export async function spawnSimArchetypes(args: {
  casuals: number,
  regulars: number,
  whales: number,
}): Promise<SimSpawnResult> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("simulate_spawn_archetypes", {
    p_casuals: args.casuals,
    p_regulars: args.regulars,
    p_whales: args.whales,
  })
  if (error) throw new Error(error.message)
  return (data ?? {casuals: 0, regulars: 0, whales: 0}) as unknown as SimSpawnResult
}

/**
 * Delete every synthetic test profile (and its auth.users row). Returns
 * the number of profiles removed. The RPC's error message is preserved
 * verbatim so the caller can surface it to the operator.
 */
export async function cleanupSimAll(): Promise<number> {
  if (!isAdminSupabaseConfigured) throw new Error(MISSING_CONFIG_MESSAGE)
  const {
    data,
    error,
  } = await sb.rpc("simulate_cleanup_all")
  if (error) throw new Error(error.message)
  return data ?? 0
}
