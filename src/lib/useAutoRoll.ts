import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'gammon.auto-roll';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Local-only auto-roll preference. When enabled, the player's dice are
 * rolled automatically as soon as it's their turn — they don't have to
 * tap "Roll" each turn. Stored in localStorage; we'll move it to the
 * Supabase profile in a follow-up so it persists across devices.
 */
export function useAutoRoll(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore quota / private mode failures */
    }
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
  }, []);

  return [enabled, setEnabled];
}

/**
 * Side-effect: when `enabled` is true AND `canRoll` is true, fire `onRoll`
 * once per "now we can roll" transition. Brief delay so the player can
 * register that the turn just changed before the dice fly.
 */
export function useAutoRollEffect(
  enabled: boolean,
  canRoll: boolean,
  onRoll: () => void
): void {
  useEffect(() => {
    if (!enabled || !canRoll) return;
    const id = window.setTimeout(() => {
      onRoll();
    }, 350);
    return () => window.clearTimeout(id);
  }, [enabled, canRoll, onRoll]);
}
