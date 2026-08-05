import {type CSSProperties, useId} from "react"

import styles from "./UnlockPill.module.css"

/**
 * Locked-content pill — collapsed it's a round gold-rimmed badge
 * (a lock, or a gem for gem-gated content). Two modes:
 *   - mode="expand" (default): tapping expands it inline into a pill
 *     reading `text` (e.g. "Reach level N to unlock" / "Get more
 *     Gems"), then it collapses on an outside click. Parent owns
 *     `open`.
 *   - mode="button": a plain badge; tapping just fires onOpen (no
 *     inline text, no open state).
 *
 * Sizing is em-based — the whole pill scales off a single font-size.
 * Set it via `wrapStyle={{ fontSize: ... }}` (e.g. a container-query
 * unit so the collapsed size tracks a percentage-based slot).
 */
export type UnlockPillProps = {
  /** expand: inline text on tap. button: tap → onOpen only. */
  readonly mode?: "expand" | "button",
  /** Collapsed glyph: gold lock (level gate) or gem (gem gate). */
  readonly variant?: "lock" | "gem",
  /** Level required — used to build the default expand text. */
  readonly level?: number,
  /** Expand text. Defaults to "Reach level {level} to unlock". */
  readonly text?: string,
  /** Expanded when true (expand mode, parent-controlled). */
  readonly open?: boolean,
  /** Fired on tap. */
  readonly onOpen: () => void,
  /** Positioning classes for the outer wrap. */
  readonly wrapClassName?: string,
  /** Inline style on the wrap — typically the font-size that sizes it. */
  readonly wrapStyle?: CSSProperties,
  /** aria-label for the collapsed state. */
  readonly ariaLabel?: string,
}

export function UnlockPill({
  mode = "expand",
  variant = "lock",
  level,
  text,
  open = false,
  onOpen,
  wrapClassName = "",
  wrapStyle,
  ariaLabel = "Locked",
}: UnlockPillProps) {
  // Unique gradient id per instance so multiple locks on screen don't
  // all reference (and break when one unmounts) a shared #id.
  const gradientId = useId().replace(/:/g, "")
  const isExpanded = mode === "expand" && open
  const expandText = text ?? (level != null ? `Reach level ${level} to unlock` : "")

  return (<div
    className={`${styles.unlockPillWrap} ${wrapClassName}`}
    style={wrapStyle}>
    <button
      aria-label={isExpanded ? expandText : ariaLabel}
      className={`${styles.unlockPill} ${isExpanded ? styles.isOpen : ""}`}
      style={{touchAction: "manipulation"}}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
      }}
      onTouchEnd={(e) => {
        e.stopPropagation()
      }}
      onTouchStart={(e) => {
        e.stopPropagation()
      }}>
      <span
        aria-hidden="true"
        className={styles.unlockIcon}>
        {variant === "gem" ? (<img
          alt=""
          draggable={false}
          src="/lobby/carousel/gem.webp"/>) : (
          <svg
            aria-hidden="true"
            fill={`url(#${gradientId})`}
            viewBox="0 0 24 24">
            <defs>
              <linearGradient
                id={gradientId}
                x1="0"
                x2="0"
                y1="0"
                y2="1">
                <stop
                  offset="0%"
                  stopColor="#fff2a2"/>
                <stop
                  offset="45%"
                  stopColor="#f3c14c"/>
                <stop
                  offset="100%"
                  stopColor="#b97918"/>
              </linearGradient>
            </defs>
            <path
              d="M12 1.5a5 5 0 0 0-5 5V10H6.5A2.5 2.5 0 0 0 4 12.5v8A2.5 2.5 0 0 0 6.5 23h11a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 17.5 10H17V6.5a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3V10H9V6.5a3 3 0 0 1 3-3zm0 11a2 2 0 0 1 .8 3.83V20.5a.8.8 0 0 1-1.6 0v-2.17A2 2 0 0 1 12 14.5z"/>
          </svg>)}
      </span>
      {mode === "expand" ? <span className={styles.unlockText}>{expandText}</span> : null}
    </button>
  </div>)
}
