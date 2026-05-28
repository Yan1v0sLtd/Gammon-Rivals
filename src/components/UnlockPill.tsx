import { useId, type CSSProperties } from 'react';

/**
 * Locked-content pill. Collapsed it's a round gold-rimmed lock badge;
 * tapped it expands into a pill that reads "Reach level N to unlock".
 * Controlled: the parent owns the `open` flag (so only one is open at
 * a time and an outside-click can collapse it).
 *
 * Sizing is em-based — the whole pill scales off a single font-size.
 * Set it via `wrapStyle={{ fontSize: ... }}`; the collapsed pill is a
 * 1em square, the expanded pill ~3.97em wide. On the board we pass a
 * container-query font-size so the collapsed size tracks the previous
 * percentage-based lock.
 *
 * A wrapper handles positioning/centering so the pill keeps its own
 * hover-lift transform without fighting a translate-based centering.
 */
export interface UnlockPillProps {
  /** Level required to unlock — rendered into the expanded text. */
  readonly level: number;
  /** Expanded when true (parent-controlled). */
  readonly open: boolean;
  /** Fired on tap — parent sets this pill open. */
  readonly onOpen: () => void;
  /** Positioning classes for the outer wrap. */
  readonly wrapClassName?: string;
  /** Inline style on the wrap — typically the font-size that sizes it. */
  readonly wrapStyle?: CSSProperties;
  /** aria-label for the collapsed state. */
  readonly ariaLabel?: string;
}

export function UnlockPill({
  level,
  open,
  onOpen,
  wrapClassName = '',
  wrapStyle,
  ariaLabel = 'Locked',
}: UnlockPillProps) {
  // Unique gradient id per instance so multiple locks on screen don't
  // all reference (and break when one unmounts) a shared #id.
  const gradientId = useId().replace(/:/g, '');

  return (
    <div className={`gr-unlock-wrap ${wrapClassName}`} style={wrapStyle}>
      <button
        type="button"
        className={`gr-unlock-pill ${open ? 'is-open' : ''}`}
        aria-label={open ? `Reach level ${level} to unlock` : ariaLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        style={{ touchAction: 'manipulation' }}
      >
        <span className="gr-unlock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill={`url(#${gradientId})`} aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff2a2" />
                <stop offset="45%" stopColor="#f3c14c" />
                <stop offset="100%" stopColor="#b97918" />
              </linearGradient>
            </defs>
            <path d="M12 1.5a5 5 0 0 0-5 5V10H6.5A2.5 2.5 0 0 0 4 12.5v8A2.5 2.5 0 0 0 6.5 23h11a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 17.5 10H17V6.5a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3V10H9V6.5a3 3 0 0 1 3-3zm0 11a2 2 0 0 1 .8 3.83V20.5a.8.8 0 0 1-1.6 0v-2.17A2 2 0 0 1 12 14.5z" />
          </svg>
        </span>
        <span className="gr-unlock-text">Reach level {level} to unlock</span>
      </button>
    </div>
  );
}
