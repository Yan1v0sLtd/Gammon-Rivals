import {isSupabaseConfigured, supabase} from '../../lib/supabase';
import type {Database} from '../../../../../packages/shared/src/database';

export type BoardThemeConfigRow = Database['public']['Tables']['board_theme_configs']['Row'];
export type DailyBonusConfigRow = Database['public']['Tables']['daily_bonus_configs']['Row'];
export type UserDailyBonusRow = Database['public']['Tables']['user_daily_bonuses']['Row'];
export type TableConfigRow = Database['public']['Tables']['table_configs']['Row'];

/* RPC payload types — the JSON each RPC returns, not database table rows. */

export type MissionRarity = 'common' | 'rare' | 'epic';
export type MissionPeriod = 'daily' | 'weekly';
export type RewardKind = 'currency' | 'item';

export interface RewardItem {
  readonly reward_kind: RewardKind;
  readonly currency_code: string | null;
  readonly item_table: string | null;
  readonly item_id: string | null;
  readonly amount: number;
  readonly display_order: number;
}

export interface Mission {
  readonly id: string;
  readonly template_id: string;
  readonly rarity: MissionRarity;
  readonly period: MissionPeriod;
  readonly title: string;
  readonly subtitle: string | null;
  readonly icon_url: string | null;
  readonly mission_type: string;
  readonly metric_code: string;
  readonly progress: number;
  readonly resolved_goal: number;
  readonly completed_at: string | null;
  readonly claimed_at: string | null;
  readonly expires_at: string;
  readonly mission_points: number;
  readonly rewards: readonly RewardItem[];
}

export interface WeeklyPass {
  readonly week_key: string;
  readonly mp_earned: number;
  readonly chests_claimed: readonly number[];
  readonly streak_bonus_active: boolean;
}

export interface ChestMilestone {
  readonly milestone_index: number;
  readonly threshold_mp: number;
  readonly display_name: string;
  readonly rarity: string;
  readonly rewards: readonly RewardItem[];
}

export interface StreakState {
  readonly current_streak_days: number;
  readonly last_complete_date: string | null;
  readonly total_streak_chests_claimed: number;
}

export interface RerollState {
  readonly rerolls_today: number;
  readonly daily_cap: number;
  readonly gem_cost_ladder: readonly number[];
  readonly next_cost: number | null;
}

export interface MissionsState {
  readonly missions: readonly Mission[];
  readonly weekly_pass: WeeklyPass;
  readonly chest_milestones: readonly ChestMilestone[];
  readonly streak: StreakState;
  readonly streak_chest_rewards: readonly RewardItem[];
  readonly reroll: RerollState;
}

export interface WheelReward {
  readonly type: string;
  readonly amount: number;
  readonly icon_url: string | null;
}

export interface WheelSlot {
  readonly slot_index: number;
  readonly chance_basis_points: number;
  readonly label: string | null;
  readonly accent_color: string;
  readonly is_enabled: boolean;
  readonly primary_reward: WheelReward;
  readonly secondary_reward: WheelReward | null;
}

export interface WheelState {
  readonly config_id: string;
  readonly display_name: string;
  readonly cooldown_seconds: number;
  readonly is_enabled: boolean;
  readonly next_spin_at: string; // ISO
  readonly can_spin_now: boolean;
  readonly last_spin_at: string | null;
  readonly last_slot_index: number | null;
  readonly slots: readonly WheelSlot[];
}

export interface LobbyFeatureConfig {
  readonly unlockLevel: number;
  readonly isEnabled: boolean;
  /** Operator-set tooltip override; null/blank → default "Reach level N…". */
  readonly tooltipText: string | null;
}

export type LobbyFeatureConfigMap = Readonly<Record<string, LobbyFeatureConfig>>;

export interface ClaimDailyBonusResult {
  readonly day_claimed?: number;
  readonly reward_coins?: number;
  readonly reward_gems?: number;
  readonly reward_xp?: number;
}

export interface ClaimMissionResult {
  readonly credited_coins?: number;
  readonly credited_gems?: number;
  readonly credited_xp?: number;
}

/** Full shape `spin_wheel` returns; WheelModal drives its animation from it. */
export interface WheelSpinResult {
  readonly slot_index: number;
  readonly label: string | null;
  readonly accent_color: string;
  readonly primary_reward: {
    readonly type: string; readonly amount: number; readonly icon_url: string | null;
  };
  readonly secondary_reward: {
    readonly type: string; readonly amount: number; readonly icon_url: string | null;
  } | null;
  readonly credited_coins: number;
  readonly credited_gems: number;
  readonly credited_xp: number;
  readonly next_spin_at: string;
  readonly wallet: { readonly coins: number; readonly gems: number };
  readonly profile: { readonly xp: number; readonly level: number };
}

export async function fetchLobbyBoards(): Promise<readonly BoardThemeConfigRow[]> {
  if (!isSupabaseConfigured) return [];
  const {
    data,
    error
  } = await supabase
    .from('board_theme_configs')
    .select('*')
    .eq('is_enabled', true)
    .order('sort_order', {ascending: false});
  if (error) throw error;
  return data ?? [];
}

/**
 * Plain string array (never a Set/Map) so it stays serializable in the
 * RTK Query cache entry.
 */
export async function fetchUserBoardInventory(userId: string): Promise<readonly string[]> {
  if (!isSupabaseConfigured) return [];
  const {
    data,
    error
  } = await supabase
    .from('user_board_inventory')
    .select('board_theme_id')
    .eq('profile_id', userId);
  if (error) throw error;
  return data?.map((row) => row.board_theme_id) ?? [];
}

export async function fetchLobbyFeatureConfigs(): Promise<LobbyFeatureConfigMap> {
  if (!isSupabaseConfigured) return {};
  const {
    data,
    error
  } = await supabase
    .from('lobby_feature_configs')
    .select('feature_key, unlock_level, is_enabled, tooltip_text');
  if (error) throw error;
  const map: Record<string, LobbyFeatureConfig> = {};
  for (const row of data ?? []) {
    map[row.feature_key] = {
      unlockLevel: row.unlock_level,
      isEnabled: row.is_enabled,
      tooltipText: row.tooltip_text,
    };
  }
  return map;
}

export async function fetchDailyBonusConfigs(): Promise<readonly DailyBonusConfigRow[]> {
  if (!isSupabaseConfigured) return [];
  const {
    data,
    error
  } = await supabase
    .from('daily_bonus_configs')
    .select('*')
    .order('day', {ascending: true});
  if (error) throw error;
  return data ?? [];
}

export async function fetchDailyBonusState(userId: string): Promise<UserDailyBonusRow | null> {
  if (!isSupabaseConfigured) return null;
  const {
    data,
    error
  } = await supabase
    .from('user_daily_bonuses')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchWheelState(configId: string): Promise<WheelState | null> {
  if (!isSupabaseConfigured) return null;
  const {
    data,
    error
  } = await supabase.rpc('get_wheel_state', {p_config_id: configId});
  if (error) throw error;
  return (data ?? null) as unknown as WheelState | null;
}

/** Auth-scoped RPC — no profile arg, requires a signed-in user. */
export async function fetchDailyMissions(): Promise<MissionsState | null> {
  if (!isSupabaseConfigured) return null;
  const {
    data,
    error
  } = await supabase.rpc('get_player_missions_today');
  if (error) throw error;
  return (data ?? null) as unknown as MissionsState | null;
}

/** Raw `image_url` row value; the presentation fallback asset lives in the consuming hook. */
export async function fetchActivePodium(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const {
    data,
    error
  } = await supabase
    .from('podium_images')
    .select('image_url')
    .eq('is_active', true)
    .order('sort_order', {ascending: false})
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.image_url ?? null;
}

export async function fetchTableConfigs(kind: TableConfigRow['kind']): Promise<readonly TableConfigRow[]> {
  if (!isSupabaseConfigured) return [];
  const {
    data,
    error
  } = await supabase
    .from('table_configs')
    .select('*')
    .eq('kind', kind)
    .eq('is_enabled', true)
    .order('sort_order', {ascending: true});
  if (error) throw error;
  return data ?? [];
}

/**
 * Claim today's daily bonus. Errors stay verbatim — LobbyScreen
 * pattern-matches `already_claimed` / `not_authenticated` on them.
 */
export async function claimDailyBonus(): Promise<ClaimDailyBonusResult | null> {
  const {
    data,
    error
  } = await supabase.rpc('claim_daily_bonus');
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as ClaimDailyBonusResult | null;
}

/** Buy a board with gems. Message kept verbatim for the purchase modal's known codes. */
export async function purchaseBoardWithGems(boardId: string): Promise<void> {
  const {error} = await supabase.rpc('purchase_board_with_gems', {target_board_id: boardId});
  if (error) throw new Error(error.message);
}

export async function spinWheel(configId: string): Promise<WheelSpinResult> {
  const {
    data,
    error
  } = await supabase.rpc('spin_wheel', {p_config_id: configId});
  if (error) throw new Error(error.message);
  return data as unknown as WheelSpinResult;
}

export async function claimMission(missionId: string): Promise<ClaimMissionResult | null> {
  const {
    data,
    error
  } = await supabase.rpc('claim_mission', {p_mission_id: missionId});
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as ClaimMissionResult | null;
}

export async function rerollMission(missionId: string): Promise<void> {
  const {error} = await supabase.rpc('reroll_mission', {p_mission_id: missionId});
  if (error) throw new Error(error.message);
}

export async function claimStreakChest(): Promise<void> {
  const {error} = await supabase.rpc('claim_streak_chest');
  if (error) throw new Error(error.message);
}

export async function markTutorialComplete(): Promise<void> {
  const {error} = await supabase.rpc('mark_tutorial_complete');
  if (error) throw new Error(error.message);
}
