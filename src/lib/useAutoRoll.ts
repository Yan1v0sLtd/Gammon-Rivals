import { useCallback, useEffect, useState } from 'react';

/**
 * Per-match auto-roll preference. When enabled, the player's dice are
 * rolled automatically as soon as it's their turn — they don't have to
 * tap "Roll" each turn.
 *
 * Always defaults to OFF when a match starts. The previous version
 * persisted the toggle to localStorage so it carried over between
 * matches; that meant any player who'd ever turned it on would have
 * auto-roll enabled at the start of every new match (annoying). Now
 * the toggle is session-only — players opt in fresh per match.
 */
export function useAutoRoll(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(false);

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
