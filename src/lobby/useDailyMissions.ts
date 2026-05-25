import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/**
 * Daily Missions client-side state hook.
 *
 * Mirrors useWheelState's shape: single RPC fetch with refetch
 * helper. Phase 6's `get_player_missions_today` RPC returns a
 * fully-formed jsonb shape with active missions, weekly pass
 * state, chest milestones + bundles, streak state + streak chest
 * bundle, and reroll pricing/usage — one round trip instead of
 * 5-7 sequential queries.
 *
 * Realtime subscriptions on player_daily_missions and
 * player_weekly_pass keep the UI live as triggers fire (e.g. a
 * match finish or a wheel spin advances mission progress).
 */

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

export interface MissionsResult {
  readonly state: MissionsState | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

export function useDailyMissions(profileId: string | undefined): MissionsResult {
  const [state, setState] = useState<MissionsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchState = useCallback(async () => {
    if (!isSupabaseConfigured || !profileId) {
      setIsLoading(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_player_missions_today');
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      setState(data as unknown as MissionsState);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, [profileId]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  // Realtime: refetch when this player's missions or weekly pass
  // changes. The DB triggers fire on match-finish / wheel-spin /
  // gem-debit etc.; the realtime hook keeps the modal live without
  // requiring the player to close/reopen it.
  useEffect(() => {
    if (!isSupabaseConfigured || !profileId) return;
    const channel = supabase
      .channel(`missions:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_daily_missions',
          filter: `profile_id=eq.${profileId}`,
        },
        () => void fetchState(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_weekly_pass',
          filter: `profile_id=eq.${profileId}`,
        },
        () => void fetchState(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_streak',
          filter: `profile_id=eq.${profileId}`,
        },
        () => void fetchState(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, fetchState]);

  return { state, isLoading, error, refetch: fetchState };
}

/** Compute milliseconds until the soonest active mission expires.
 *  Used by the header countdown ("Refreshes in 12h 43m"). */
export function nextResetMs(state: MissionsState | null): number {
  if (!state) return 0;
  const dailies = state.missions.filter((m) => m.period === 'daily');
  if (dailies.length === 0) return 0;
  const earliest = dailies
    .map((m) => new Date(m.expires_at).getTime())
    .sort((a, b) => a - b)[0];
  return Math.max(0, earliest - Date.now());
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${m}m ${s}s`;
}
