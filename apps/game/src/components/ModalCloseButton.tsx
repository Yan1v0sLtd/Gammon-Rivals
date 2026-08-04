type ModalCloseButtonProps = {
  readonly onClose: () => void,
  readonly ariaLabel: string,
  /**
   * Positioning utilities only (e.g. `absolute right-[4%] top-[5%]`). The
   * size, shape and colour are baked in here so every modal's close button
   * is pixel-identical — callers control ONLY where it sits.
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
 * Used by both HowToPlayModal and DailyBonusModal so the two close buttons
 * are identical in size and style; each modal supplies only the positioning
 * via `className` (both place it inside their frame's top-right corner).
 */
export function ModalCloseButton({
  onClose,
  ariaLabel,
  className = "",
  disabled = false,
}: ModalCloseButtonProps) {
  return (<button
    aria-label={ariaLabel}
    className={`grid h-[1.875rem] w-[1.875rem] place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-base font-black leading-none text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,212,135,0.22)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    disabled={disabled}
    type="button"
    onClick={onClose}>
    ✕
  </button>)
}
