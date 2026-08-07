import styles from "./AutoRollToggle.module.css"

type Props = {
  enabled: boolean,
  onChange: (next: boolean) => void,
  className?: string,
  variant?: "panel" | "inline",
}

/**
 * Vertical pill toggle for the auto-roll preference. Rendered in the
 * right side panel beside the player's avatar — when on, the dice are
 * rolled automatically at the start of the player's turn.
 */
export function AutoRollToggle({
  enabled,
  onChange,
  className = "",
  variant = "panel",
}: Props) {
  if (variant === "inline") {
    return (<button
      aria-pressed={enabled}
      className={`${styles.autoToggle} ${enabled ? styles.on : ""} ${className}`}
      title={enabled ? "Auto-roll is on" : "Auto-roll is off"}
      type="button"
      onClick={() => {
        onChange(!enabled)
      }}>
      <span className={styles.autoSwitch}>
        <span className={styles.autoKnob}/>
      </span>
      <span className={styles.autoLabel}>
        Auto
      </span>
    </button>)
  }

  return (<button
    aria-pressed={enabled}
    className={`${styles.panelToggle} ${enabled ? styles.on : ""} ${className}`}
    title={enabled ? "Auto-roll is on" : "Auto-roll is off"}
    type="button"
    onClick={() => {
      onChange(!enabled)
    }}>
    <span className={styles.panelSwitch}>
      <span className={styles.panelKnob}/>
      <span className={styles.panelState}>
        {enabled ? "ON" : "OFF"}
      </span>
    </span>
    <span className={styles.panelLabel}>
      Auto Roll
    </span>
  </button>)
}
