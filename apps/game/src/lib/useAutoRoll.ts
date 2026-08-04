import {useCallback, useState} from "react"

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
  const [enabled, setEnabled] = useState<boolean>(false)

  const setAutoRollEnabled = useCallback((next: boolean) => {
    setEnabled(next)
  }, [])

  return [enabled, setAutoRollEnabled]
}
