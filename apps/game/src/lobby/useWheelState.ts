import { useCallback, useEffect, useState } from 'react';
import { useGetWheelStateQuery } from '../features/lobby/lobbyApi';
import { isSupabaseConfigured } from '../lib/supabase';
import type { WheelState } from '../features/lobby/lobbyData';

export interface WheelStateResult {
  /** null while the first fetch is in flight, or if Supabase is
   *  not configured. Components should render a neutral
   *  placeholder when null. */
  readonly state: WheelState | null;
  /** Seconds remaining until the next spin, computed at RENDER time —
   *  it does NOT tick. A component that displays a live countdown must
   *  use useCountdownSeconds(state.next_spin_at) locally, so only that
   *  small component re-renders each second. */
  readonly secondsUntilSpin: number;
  /** Server-authoritative "the wheel can spin right now". Flips via the
   *  scheduled zero-crossing re-fetch in the getWheelState endpoint
   *  lifecycle (never from the client clock, which could run fast and
   *  enable Claim early). */
  readonly canSpin: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Manually re-fetch (e.g., after a successful spin or after the
   *  BO updates the wheel config). */
  readonly refetch: () => void;
}

/**
 * Wheel state compatibility hook used by the lobby pill + the wheel modal.
 *
 * The fetch and the cooldown zero-crossing re-fetch (which flips the
 * server's authoritative `can_spin_now`) are owned by the `getWheelState`
 * endpoint's `onCacheEntryAdded` lifecycle in lobbyApi; this hook only
 * adapts that cache entry into the legacy view-model shape below.
 *
 * PERF NOTE: this hook used to run a permanent 1 Hz interval to tick the
 * countdown. It is consumed by LobbyScreen, so that ticked a re-render of
 * the ENTIRE lobby tree every second, forever — a constant CPU tax that
 * phones really felt. The countdown display now ticks locally inside the
 * pill via useCountdownSeconds() (a few DOM nodes/second instead of the
 * whole lobby).
 */
export function useWheelState(configId: string = 'main'): WheelStateResult {
  const {
    data,
    error: queryError,
    isLoading,
    isUninitialized,
    refetch: refetchQuery,
  } = useGetWheelStateQuery(configId, { skip: !isSupabaseConfigured });

  const state = data ?? null;

  const secondsUntilSpin = state
    ? Math.max(0, Math.ceil((new Date(state.next_spin_at).getTime() - Date.now()) / 1000))
    : 0;

  const canSpin = !!state && state.is_enabled && state.can_spin_now;

  return {
    state,
    secondsUntilSpin,
    canSpin,
    // A fresh subscription renders uninitialized (isLoading false) for one
    // frame before the fetch starts; count that wait so nothing briefly
    // renders as ready. Skipped (unconfigured) queries stay uninitialized
    // forever, so only count it when Supabase is configured.
    isLoading: isLoading || (isSupabaseConfigured && isUninitialized),
    error: queryError?.message ?? null,
    refetch: useCallback(() => {
      // RTK Query throws when refetching an entry that was never started
      // (skipped for an unconfigured client), so only refetch live entries.
      if (!isUninitialized) void refetchQuery();
    }, [isUninitialized, refetchQuery]),
  };
}

/**
 * Live 1 Hz countdown to an ISO timestamp, for the component that DISPLAYS
 * it (and only that component — see the perf note on useWheelState). The
 * interval only runs while the target is in the future.
 */
export function useCountdownSeconds(targetIso: string | null): number {
  const compute = useCallback((): number => {
    if (!targetIso) return 0;
    return Math.max(0, Math.ceil((new Date(targetIso).getTime() - Date.now()) / 1000));
  }, [targetIso]);

  const [seconds, setSeconds] = useState<number>(compute);

  useEffect(() => {
    setSeconds(compute());
    if (!targetIso) return;
    if (new Date(targetIso).getTime() <= Date.now()) return;
    const id = window.setInterval(() => {
      const next = compute();
      setSeconds(next);
      if (next <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetIso, compute]);

  return seconds;
}

/** Format a "next spin in" duration as HH:MM:SS. */
export function formatCooldown(seconds: number): string {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
