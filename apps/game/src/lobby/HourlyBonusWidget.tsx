import {formatCooldown, useCountdownSeconds, type WheelStateResult} from "../lib/useWheelState"

import styles from "./HourlyBonusWidget.module.css"

type Props = {
  readonly result: WheelStateResult,
  readonly onClaim: () => void,
}

/**
 * The lobby nav's center slot: the hourly-bonus wheel graphic plus
 * a CSS pill underneath that switches between three states:
 *
 *   - Ready    → orange gradient "CLAIM" button (large label)
 *   - Cooldown → gold-trimmed pill with the HH:MM:SS countdown
 *   - Unavailable → grey pill with "UNAVAILABLE" text
 *
 * The graphic is the same on all three states; only the pill
 * changes. State transitions cross-fade via CSS so the player
 * sees the pill morph rather than swap abruptly.
 *
 * Click handling lives in the parent (LobbyScreen) so the modal
 * trigger / matchmaking overlays stay co-located with the rest of
 * the lobby modals.
 */
export function HourlyBonusWidget({
  result,
  onClaim,
}: Props) {
  const {
    state,
    canSpin,
  } = result
  // The 1 Hz countdown ticks HERE (a few DOM nodes), not in useWheelState —
  // that hook is consumed by LobbyScreen, and ticking it re-rendered the
  // entire lobby tree every second (a permanent CPU tax on phones).
  const secondsUntilSpin = useCountdownSeconds(state?.next_spin_at ?? null)

  const pillKind: "ready" | "cooldown" | "unavailable" = !state?.is_enabled ? "unavailable" : canSpin ? "ready" : "cooldown"

  return (<div
    aria-label="Hourly bonus wheel"
    className={styles.hourlyBonus}>
    {/* Pre-rendered wheel + frame asset. Tap target is the whole
          widget — clicking the image is identical to clicking the
          pill when ready (better discoverability on touch). */}
    <button
      aria-label={pillKind === "ready" ? "Claim hourly bonus" : pillKind === "cooldown" ? `Next bonus in ${formatCooldown(secondsUntilSpin)}` : "Hourly bonus unavailable"}
      className={`${styles.image} ${pillKind === "ready" ? styles.readyImage : ""}`}
      disabled={pillKind !== "ready"}
      type="button"
      onClick={pillKind === "ready" ? onClaim : undefined}>
      <img
        alt=""
        draggable={false}
        src="/lobby/HourlyBonusFinal.webp"/>
    </button>

    {pillKind === "ready" ? (<button
      className={`${styles.pill} ${styles.readyPill}`}
      type="button"
      onClick={onClaim}>
      Claim
    </button>) : pillKind === "cooldown" ? (<div
      aria-live="polite"
      className={`${styles.pill} ${styles.cooldownPill}`}>
      {formatCooldown(secondsUntilSpin)}
    </div>) : (<div className={`${styles.pill} ${styles.unavailablePill}`}>
      Unavailable
    </div>)}
  </div>)
}
