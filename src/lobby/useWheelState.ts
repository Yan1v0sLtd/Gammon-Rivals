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
  /** Seconds remaining until the next spin is available. 0 once
   *  the cooldown has elapsed. Ticks every second locally so the
   *  UI countdown stays smooth without re-querying the RPC. */
  readonly secondsUntilSpin: number;
  /** True once secondsUntilSpin === 0 AND the server-side state
   *  agrees the wheel is enabled. */
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
 * Fetches `get_wheel_state` on mount, ticks a local 1Hz countdown
 * from the server's `next_spin_at`. When the local clock crosses
 * zero we don't blindly enable Claim — we re-fetch so the server
 * is the source of truth (it ALSO computes `can_spin_now` against
 * its own `now()`, which avoids client-clock skew triggering
 * a too-early enable).
 */
export function useWheelState(configId: string = 'main'): WheelStateResult {
  const [state, setState] = useState<WheelState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [refreshToken, setRefreshToken] = useState(0);

  // 1 Hz tick. Cheap, only refreshes a single number in render.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  // Re-fetch the moment the local countdown hits zero so the
  // server's authoritative can_spin_now flips on (and we don't
  // light up the Claim button on a client whose clock is fast).
  const nextSpinMs = state ? new Date(state.next_spin_at).getTime() : 0;
  const secondsUntilSpin = state
    ? Math.max(0, Math.ceil((nextSpinMs - now) / 1000))
    : 0;
  useEffect(() => {
    if (!state) return;
    if (state.can_spin_now) return;
    if (secondsUntilSpin > 0) return;
    // Local clock thinks we crossed zero. Re-query so the server
    // version of canSpin lights up.
    setRefreshToken((v) => v + 1);
  }, [secondsUntilSpin, state]);

  const canSpin = !!state && state.is_enabled && (state.can_spin_now || secondsUntilSpin === 0);

  return {
    state,
    secondsUntilSpin,
    canSpin,
    isLoading,
    error,
    refetch: useCallback(() => setRefreshToken((v) => v + 1), []),
  };
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
