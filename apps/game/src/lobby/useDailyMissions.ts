import { useCallback } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { useGetDailyMissionsQuery } from '../features/lobby/lobbyApi';
import { isSupabaseConfigured } from '../lib/supabase';
import type { MissionsState } from '../features/lobby/lobbyData';

/**
 * Daily Missions client-side compatibility hook.
 *
 * The fetch and the three-table Realtime invalidation channel are owned
 * by the `getDailyMissions` endpoint's `onCacheEntryAdded` lifecycle in
 * lobbyApi; this hook only adapts that cache entry into the legacy
 * view-model shape below. Phase 6's `get_player_missions_today` RPC
 * returns a fully-formed jsonb shape with active missions, weekly pass
 * state, chest milestones + bundles, streak state + streak chest
 * bundle, and reroll pricing/usage — one round trip instead of
 * 5-7 sequential queries.
 */

export interface MissionsResult {
  readonly state: MissionsState | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

export function useDailyMissions(profileId: string | undefined): MissionsResult {
  const {
    data,
    error: queryError,
    isLoading,
    isUninitialized,
    refetch: refetchQuery,
  } = useGetDailyMissionsQuery(profileId ?? skipToken, { skip: !isSupabaseConfigured });

  return {
    state: data ?? null,
    // A fresh subscription renders uninitialized (isLoading false) for one
    // frame before the fetch starts; count that wait so the modal shows
    // "Loading missions…" rather than "No missions today.". Skipped
    // queries (unconfigured client, or no profile id yet) stay
    // uninitialized forever, so only count it when the query will run.
    isLoading: isLoading || (isSupabaseConfigured && !!profileId && isUninitialized),
    error: queryError?.message ?? null,
    refetch: useCallback(() => {
      // RTK Query throws when refetching an entry that was never started
      // (skipped for an unconfigured client or a missing profile id), so
      // only refetch live entries.
      if (!isUninitialized) void refetchQuery();
    }, [isUninitialized, refetchQuery]),
  };
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
