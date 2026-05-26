import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/**
 * Pulls the three stats shown on the new premium lobby profile card —
 * highest single match-reward payout, current daily-missions streak
 * days, and overall win rate. One RPC round-trip (see migration
 * 20260630000000_lobby_profile_stats_rpc.sql); the function is
 * `stable security definer` so RLS doesn't block it.
 *
 * Refetches on profileId change (login / logout) and exposes a
 * `refresh()` for callers that just credited a wallet or finished
 * a match. No realtime subscription — the stats don't move often
 * enough to justify a live channel, and the lobby is the only
 * surface that reads them today.
 */

export interface LobbyProfileStats {
  readonly highestWin: number;
  readonly streakDays: number;
  readonly wins: number;
  readonly totalFinished: number;
  readonly winRatePct: number;
}

export interface LobbyProfileStatsResult {
  readonly stats: LobbyProfileStats | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  refresh(): Promise<void>;
}

const EMPTY_STATS: LobbyProfileStats = {
  highestWin: 0,
  streakDays: 0,
  wins: 0,
  totalFinished: 0,
  winRatePct: 0,
};

interface RpcShape {
  readonly highest_win?: number | null;
  readonly streak_days?: number | null;
  readonly wins?: number | null;
  readonly total_finished?: number | null;
  readonly win_rate_pct?: number | null;
}

function normalize(raw: RpcShape | null): LobbyProfileStats {
  if (!raw) return EMPTY_STATS;
  return {
    highestWin: Math.max(0, Math.trunc(raw.highest_win ?? 0)),
    streakDays: Math.max(0, Math.trunc(raw.streak_days ?? 0)),
    wins: Math.max(0, Math.trunc(raw.wins ?? 0)),
    totalFinished: Math.max(0, Math.trunc(raw.total_finished ?? 0)),
    winRatePct: Math.max(0, Math.min(100, Math.trunc(raw.win_rate_pct ?? 0))),
  };
}

export function useLobbyProfileStats(profileId: string | undefined): LobbyProfileStatsResult {
  const [stats, setStats] = useState<LobbyProfileStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchStats = useCallback(async () => {
    // Without Supabase or a profile id there's nothing to fetch — bail
    // and let the card render its placeholder zeros.
    if (!isSupabaseConfigured || !profileId) {
      setIsLoading(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_player_lobby_stats');
      if (rpcErr) {
        setError(rpcErr.message);
        setStats(null);
      } else {
        setStats(normalize(data as RpcShape | null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStats(null);
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    setIsLoading(true);
    void fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refresh: fetchStats,
  };
}
