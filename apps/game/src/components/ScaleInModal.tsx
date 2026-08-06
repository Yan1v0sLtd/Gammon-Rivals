import {type CSSProperties, type MouseEvent, type ReactNode, useEffect, useState} from "react"

import styles from "./ScaleInModal.module.css"

type ScaleInModalProps = {
  /** Fired on backdrop click (if enabled) and on Escape. */
  readonly onClose?: () => void,
  /** Close when the dimmed backdrop (not the content) is clicked. Default true. */
  readonly closeOnBackdropClick?: boolean,
  /** Close on the Escape key. Default true. */
  readonly closeOnEscape?: boolean,
  /** Classes for the centered content wrapper (sizing, etc.). */
  readonly className?: string,
  /** Inline style for the content wrapper (composed with the entrance transform). */
  readonly style?: CSSProperties,
  readonly children: ReactNode,
}

/**
 * Shared "emerge" modal shell — the springy scale-in entrance the lobby
 * board-purchase popup uses (the diamond/lock → popup effect). Flips an
 * `entered` flag on the frame after mount so the CSS transitions run:
 *   • backdrop fades in
 *   • content springs from ~scale(0.12) up to its natural size
 *
 * The entrance transform lives on a WRAPPER around `children`, so a child
 * that carries its own transform (e.g. a responsive `scale(0.89)`) keeps
 * it — the two compose (the child emerges from 0.12× its own scale up to
 * its own scale). Use this anywhere we want the lobby's signature popup
 * open animation.
 */
export function ScaleInModal({
  onClose,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className,
  style,
  children,
}: ScaleInModalProps) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true)
    })
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (!onClose || !closeOnEscape) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose, closeOnEscape])

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (!onClose || !closeOnBackdropClick) return
    // Only a click on the backdrop itself — not bubbled from the content.
    if (event.target === event.currentTarget) onClose()
  }

  return (<div
    className={`${styles.backdrop} ${entered ? styles.backdropEntered : ""}`}
    onClick={handleBackdrop}>
    <div
      className={`${styles.content} ${entered ? styles.contentEntered : ""} ${className ?? ""}`}
      style={style}>
      {children}
    </div>
  </div>)
}
