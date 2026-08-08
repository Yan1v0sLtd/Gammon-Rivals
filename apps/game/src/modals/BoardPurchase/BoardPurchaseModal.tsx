import {useEffect, useState} from "react"

import styles from "./BoardPurchaseModal.module.css"

type BoardPurchaseModalProps = {
  readonly boardName: string,
  readonly priceGems: number,
  readonly isPurchasing: boolean,
  readonly errorMessage: string | null,
  readonly onConfirm: () => void,
  readonly onCancel: () => void,
}

/**
 * Confirmation modal shown when a player taps an owned-with-gems board.
 * Carnival/fortune-card style matching the rest of the lobby chrome
 * (HourlyBonus modal): heavy gold rim, decorative corner rivets, big
 * red close orb, dark-red name ribbon, gold price plate with the
 * existing /lobby/carousel/gem.webp icon, Yes/No 3D buttons.
 *
 * Props are unchanged from the previous version — LobbyScreen needs
 * no edits to adopt the new look.
 */
export function BoardPurchaseModal({
  boardName,
  priceGems,
  isPurchasing,
  errorMessage,
  onConfirm,
  onCancel,
}: BoardPurchaseModalProps) {
  // Enter animation: the gold card scales up out of nothing (the
  // "emerge from the lock" effect) while the backdrop fades in. Flip
  // `entered` on the frame after mount so the CSS transition runs.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true)
    })
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  return (<div
    className={styles.backdrop}
    style={{
      opacity: entered ? 1 : 0,
      transition: "opacity 220ms ease",
    }}>
    {/* Gold modal frame. Multiple stacked box-shadows fake the
          orange-rim-on-gold rim-on-brown trim from the reference. */}
    <div
      className={styles.frame}
      style={{
        // Scale-up "emerge" entrance (springy), matching the unlock
        // pill → popup animation.
        transform: entered ? "scaleX(1) scaleY(1)" : "scaleX(0.16) scaleY(0.12)",
        opacity: entered ? 1 : 0,
        transition: "transform 460ms cubic-bezier(0.2, 0.9, 0.2, 1.12), opacity 220ms ease",
        transitionDelay: entered ? "120ms" : "0ms",
      }}>
      {/* Decorative inset border ring */}
      <div
        aria-hidden
        className={styles.insetRing}/>

      {/* Four gold corner rivets — L-shaped border w/ a gold disc
            in each corner, matching the reference. */}
      {(["tl", "tr", "bl", "br"] as const).map((pos) => {
        const rivetClass = pos === "tl" ? styles.rivetTl
          : pos === "tr" ? styles.rivetTr
            : pos === "bl" ? styles.rivetBl
              : styles.rivetBr
        const discClass = pos === "tl" ? styles.rivetDiscTl
          : pos === "tr" ? styles.rivetDiscTr
            : pos === "bl" ? styles.rivetDiscBl
              : styles.rivetDiscBr
        return (<div
          key={pos}
          aria-hidden
          className={`${styles.rivet} ${rivetClass}`}>
          <span className={`${styles.rivetDisc} ${discClass}`}/>
        </div>)
      })}

      {/* Close orb — large red sphere with thick gold rim, sits
            outside the top-right corner. */}
      <button
        aria-label="Cancel"
        className={styles.closeButton}
        disabled={isPurchasing}
        type="button"
        onClick={onCancel}>
        ×
      </button>

      {/* Title — ✦ UNLOCK BOARD ✦ with the multi-layer text shadow
            from the reference (gold-on-cream-on-brown stack). Sized
            down + whitespace-nowrap so the title stays on one line
            even at the narrow modal-width breakpoint (it was
            wrapping to UNLOCK / BOARD before). */}
      <h2
        className={styles.title}>
        <span className={styles.titleStar}>
          ✦
        </span>
        UNLOCK BOARD
        <span className={styles.titleStar}>
          ✦
        </span>
      </h2>

      {/* Board name ribbon — dark-red banner with diamond caps. */}
      <div
        className={styles.nameRibbon}>
        {/* Diamond caps on each end of the ribbon. */}
        <span
          aria-hidden
          className={`${styles.ribbonCap} ${styles.ribbonCapLeft}`}/>
        <span
          aria-hidden
          className={`${styles.ribbonCap} ${styles.ribbonCapRight}`}/>
        {boardName}
      </div>

      {/* Price plate — gold rounded card with the actual gem.webp
            asset + the price number. The hanging "GEMS" badge was
            removed per user request — the icon already conveys the
            currency and the prompt text ("100 Gems") spells it out. */}
      <div
        className={styles.pricePlate}>
        {/* Sheen highlight on the top-left of the plate */}
        <span
          aria-hidden
          className={styles.sheen}/>

        <img
          alt=""
          className={styles.gemIcon}
          draggable={false}
          src="/lobby/carousel/gem.webp"/>
        <span
          className={styles.priceValue}>
          {priceGems.toLocaleString()}
        </span>
      </div>

      {/* Confirmation prompt. */}
      <p
        className={styles.prompt}>
        Would you like to unlock for{" "}
        <strong className={styles.promptStrong}>{priceGems.toLocaleString()} Gems?</strong>
      </p>

      {/* Decorative divider with the ✤ glyph in the centre. */}
      <div
        className={styles.divider}>
        <span className={styles.dividerLine}/>
        <span>✤</span>
        <span className={styles.dividerLine}/>
      </div>

      {/* Error message (RPC failures). */}
      {errorMessage ? (<div
        className={styles.error}>
        {errorMessage}
      </div>) : null}

      {/* Yes / No buttons — re-styled to match the green PLAY
            button on the lobby board carousel (PlayButton). Yes
            uses the same green/lime gradient stack,
            No uses the same shape but a charcoal palette. Pill
            shape, dual-layer background (top white-sheen overlay +
            base gradient), thin lime/grey rim, chunky 3D drop-shadow
            that compresses on press. */}
      <div
        className={styles.buttonRow}>
        <button
          className={`${styles.actionButton} ${styles.actionButtonYes}`}
          disabled={isPurchasing}
          type="button"
          onClick={onConfirm}>
          {isPurchasing ? "…" : "Yes"}
        </button>
        <button
          className={`${styles.actionButton} ${styles.actionButtonNo}`}
          disabled={isPurchasing}
          type="button"
          onClick={onCancel}>
          No
        </button>
      </div>
    </div>
  </div>)
}
