import styles from "./ModalCloseButton.module.css"

type ModalCloseButtonProps = {
  readonly onClose: () => void,
  readonly ariaLabel: string,
  /**
   * Positioning only — a caller-owned CSS Module class (e.g. `styles.closeButton`
   * in the modal's own module). The size, shape and colour are baked in here so
   * every modal's close button is pixel-identical — callers control ONLY where
   * it sits.
   */
  readonly className?: string,
  /** When true the button is dimmed + non-interactive (e.g. the wheel can't be
   *  closed mid-spin). Defaults to false. */
  readonly disabled?: boolean,
}

/**
 * Shared modal close (✕) button — a gold-rimmed dark disc, fixed at 1.875rem
 * (30px; was 40px — shrunk 25% per operator review that it read too large).
 *
 * Used by the modal family — HowToPlayModal, WheelModal and DailyBonusModal —
 * so every close button is identical in size and style; each modal supplies
 * only the positioning via its own CSS Module `className` (all three place it
 * inside their frame's top-right corner).
 */
export function ModalCloseButton({
  onClose,
  ariaLabel,
  className = "",
  disabled = false,
}: ModalCloseButtonProps) {
  return (<button
    aria-label={ariaLabel}
    className={`${styles.closeButton} ${className}`}
    disabled={disabled}
    type="button"
    onClick={onClose}>
    ✕
  </button>)
}
