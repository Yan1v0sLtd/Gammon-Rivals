import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

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
   *  scheduled zero-crossing re-fetch below (never from the client clock,
   *  which could run fast and enable Claim early). */
  readonly canSpin: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Manually re-fetch (e.g., after a successful spin or after the
   *  BO updates the wheel config). */
  readonly refetch: () => void;
}

/**
 * Wheel state hook used by the lobby pill + the wheel modal.
 *
 * Fetches `get_wheel_state` on mount and schedules ONE timeout for the
 * cooldown's zero-crossing, at which point it re-fetches so the server's
 * authoritative `can_spin_now` flips Claim on.
 *
 * PERF NOTE: this hook used to run a permanent 1 Hz interval to tick the
 * countdown. It is consumed by LobbyScreen, so that ticked a re-render of
 * the ENTIRE lobby tree every second, forever — a constant CPU tax that
 * phones really felt. The countdown display now ticks locally inside the
 * pill via useCountdownSeconds() (a few DOM nodes/second instead of the
 * whole lobby).
 */
export function useWheelState(configId: string = 'main'): WheelStateResult {
  const [state, setState] = useState<WheelState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void supabase.rpc('get_wheel_state', { p_config_id: configId }).then(({ data, error: err }) => {
      if (cancelled) return;
      setIsLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      setState(data as unknown as WheelState);
    });
    return () => {
      cancelled = true;
    };
  }, [configId, refreshToken]);

  // Schedule a single re-fetch for the moment the cooldown elapses so the
  // server's `can_spin_now` flips on. The 1.5s floor keeps a server that
  // (pathologically) reports a past next_spin_at with can_spin_now=false
  // from re-fetching in a tight loop.
  useEffect(() => {
    if (!state || !state.is_enabled || state.can_spin_now) return;
    const untilZero = new Date(state.next_spin_at).getTime() - Date.now();
    const delay = Math.min(Math.max(untilZero + 250, 1500), 2 ** 31 - 1);
    const id = window.setTimeout(() => setRefreshToken((v) => v + 1), delay);
    return () => window.clearTimeout(id);
  }, [state]);

  const secondsUntilSpin = state
    ? Math.max(0, Math.ceil((new Date(state.next_spin_at).getTime() - Date.now()) / 1000))
    : 0;

  const canSpin = !!state && state.is_enabled && state.can_spin_now;

  return {
    state,
    secondsUntilSpin,
    canSpin,
    isLoading,
    error,
    refetch: useCallback(() => setRefreshToken((v) => v + 1), []),
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
