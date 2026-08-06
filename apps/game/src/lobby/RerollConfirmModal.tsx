import {useEffect, useState} from "react"

import styles from "./RerollConfirmModal.module.css"

/** Reroll confirmation popup — carnival/gold style matching BoardPurchaseModal,
 *  asking the player to confirm spending gems (or a free reroll). */
export function RerollConfirmModal({
  priceGems,
  isBusy,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  readonly priceGems: number,
  readonly isBusy: boolean,
  readonly errorMessage: string | null,
  readonly onConfirm: () => void,
  readonly onCancel: () => void,
}) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true)
    })
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])
  const free = priceGems <= 0
  return (
    <div className={`${styles.backdrop} ${entered ? styles.backdropEntered : ""}`}>
      <div className={`${styles.card} ${entered ? styles.cardEntered : ""}`}>
        <button
          aria-label="Cancel"
          className={styles.closeButton}
          disabled={isBusy}
          type="button"
          onClick={onCancel}>
          ×
        </button>

        <h2 className={styles.title}>
          <span className={styles.titleStar}>✦</span>
          REROLL MISSION
          <span className={styles.titleStar}>✦</span>
        </h2>

        {!free && (<div className={styles.priceBox}>
          <img
            alt=""
            className={styles.priceGem}
            draggable={false}
            src="/lobby/carousel/gem.webp"/>
          <span className={styles.priceValue}>
            {priceGems.toLocaleString()}
          </span>
        </div>)}

        <p className={styles.prompt}>
          {free ? ("Reroll this mission for free?") : (<>
            Reroll this mission for{" "}
            <strong style={{fontWeight: 900}}>{priceGems.toLocaleString()} Gems?</strong>
          </>)}
        </p>

        {errorMessage ? (
          <div className={styles.error}>
            {errorMessage}
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            disabled={isBusy}
            type="button"
            onClick={onConfirm}>
            {isBusy ? "…" : "Yes"}
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonNo}`}
            disabled={isBusy}
            type="button"
            onClick={onCancel}>
            No
          </button>
        </div>
      </div>
    </div>
  )
}
