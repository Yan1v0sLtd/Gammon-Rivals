import type { ButtonHTMLAttributes, CSSProperties } from 'react';

/**
 * Shared premium "Play" button — the standardized affirmative-action
 * button across the app (board carousel, difficulty cards, daily
 * missions, …). Green gem treatment with a gold shimmer sweep and
 * optional corner sparkles.
 *
 * The whole button is sized off a single font-size (all internal
 * dimensions are in `em` — see the .gr-play-* rules in index.css), so
 * `size` is the only knob needed to scale it. For one-off sizing,
 * pass an explicit font-size via `wrapStyle={{ fontSize: '28px' }}`.
 *
 * All extra props are forwarded to the inner <button>, so callers can
 * attach onClick, disabled, aria-label, touch handlers, etc. The
 * board carousel relies on this to stop the swipe handler from eating
 * the tap on Android WebView.
 */
export interface PlayButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button label. Defaults to "Play". Keep it short (≤ ~4 chars) —
   *  the silhouette is a compact ~3:1 pill. */
  readonly label?: string;
  /** Size preset. lg = hero (board), sm = inline (difficulty / GO). */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Show the twinkling corner sparkles. Defaults to on for lg, off
   *  for sm/md (they clutter a small button). */
  readonly sparkles?: boolean;
  /** Class applied to the outer wrap — use for positioning (absolute,
   *  translate, z-index, margins). */
  readonly wrapClassName?: string;
  /** Inline style on the outer wrap — handy for a one-off font-size. */
  readonly wrapStyle?: CSSProperties;
  /** Stretch to fill the parent width instead of the natural ~3:1
   *  pill. font-size then only drives the height. */
  readonly block?: boolean;
}

export function PlayButton({
  label = 'Play',
  size = 'lg',
  sparkles,
  wrapClassName = '',
  wrapStyle,
  block = false,
  className = '',
  type = 'button',
  ...buttonProps
}: PlayButtonProps) {
  const showSparkles = sparkles ?? size === 'lg';
  return (
    <div
      className={`gr-play-wrap gr-play-${size} ${block ? 'gr-play-block' : ''} ${wrapClassName}`}
      style={wrapStyle}
    >
      {showSparkles ? (
        <>
          <i className="gr-play-sparkle" aria-hidden="true" />
          <i className="gr-play-sparkle" aria-hidden="true" />
          <i className="gr-play-sparkle" aria-hidden="true" />
        </>
      ) : null}
      <button className={`gr-play-button ${className}`} type={type} {...buttonProps}>
        <span className="gr-play-shimmer" aria-hidden="true" />
        <span className="gr-play-text">{label}</span>
      </button>
    </div>
  );
}
