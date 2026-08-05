import type {ButtonHTMLAttributes, CSSProperties} from "react"

import styles from "./PlayButton.module.css"

/**
 * Shared premium "Play" button — the standardized affirmative-action
 * button across the app (board carousel, difficulty cards, daily
 * missions, …). Green gem treatment with a gold shimmer sweep and
 * optional corner sparkles.
 *
 * The whole button is sized off a single font-size (all internal
 * dimensions are in `em` — see the playButton* rules in PlayButton.module.css), so
 * `size` is the only knob needed to scale it. For one-off sizing,
 * pass an explicit font-size via `wrapStyle={{ fontSize: '28px' }}`.
 *
 * All extra props are forwarded to the inner <button>, so callers can
 * attach onClick, disabled, aria-label, touch handlers, etc. The
 * board carousel relies on this to stop the swipe handler from eating
 * the tap on Android WebView.
 */
export type PlayButtonProps = {
  /** Button label. Defaults to "Play". Keep it short (≤ ~4 chars) —
   *  the silhouette is a compact ~3:1 pill. */
  readonly label?: string,
  /** Size preset. lg = hero (board), sm = inline (difficulty / GO). */
  readonly size?: "sm" | "md" | "lg",
  /** Show the twinkling corner sparkles. Defaults to on for lg, off
   *  for sm/md (they clutter a small button). */
  readonly sparkles?: boolean,
  /** Class applied to the outer wrap — use for positioning (absolute,
   *  translate, z-index, margins). */
  readonly wrapClassName?: string,
  /** Inline style on the outer wrap — handy for a one-off font-size. */
  readonly wrapStyle?: CSSProperties,
  /** Stretch to fill the parent width instead of the natural ~3:1
   *  pill. font-size then only drives the height. */
  readonly block?: boolean,
} & ButtonHTMLAttributes<HTMLButtonElement>

export function PlayButton({
  label = "Play",
  size = "lg",
  sparkles,
  wrapClassName = "",
  wrapStyle,
  block = false,
  className = "",
  type = "button",
  ...buttonProps
}: PlayButtonProps) {
  const showSparkles = sparkles ?? size === "lg"
  const sizeClass = {
    lg: styles.playButtonLarge,
    md: styles.playButtonMedium,
    sm: styles.playButtonSmall,
  }[size]
  return (<div
    className={`${styles.playButtonWrap} ${sizeClass} ${block ? styles.playButtonBlock : ""} ${wrapClassName}`}
    style={wrapStyle}>
    {showSparkles ? (<>
      <i
        aria-hidden="true"
        className={styles.playButtonSparkle}/>
      <i
        aria-hidden="true"
        className={styles.playButtonSparkle}/>
      <i
        aria-hidden="true"
        className={styles.playButtonSparkle}/>
    </>) : null}
    <button
      className={`${styles.playButton} ${className}`}
      type={type}
      {...buttonProps}>
      <span
        aria-hidden="true"
        className={styles.playButtonShimmer}/>
      <span className={styles.playButtonText}>{label}</span>
    </button>
  </div>)
}
