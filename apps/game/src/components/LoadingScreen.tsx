import type {FC} from "react"

import {getLoadingScreenImage} from "../lib/loadingScreenImage"

import styles from "./LoadingScreen.module.css"

type Props = {
  /** Optional 0..1 progress fraction. When provided the bar is
   *  deterministic; otherwise it eases toward ~90% on its own. */
  readonly progress?: number,
  readonly label?: string,
}

/**
 * Full-art loading screen: BO-managed background image (see
 * lib/loadingScreenImage.ts — localStorage-cached, bundled fallback) with
 * the gold striped progress bar from the brand mockup overlaid near the
 * bottom. Used as the Suspense fallback and inside NavigationLoaderOverlay, so
 * it must render instantly with zero network — the image getter is
 * synchronous and the bar is pure CSS (composited transform animation).
 */
export const LoadingScreen: FC<Props> = ({
  progress,
  label = "Loading",
}) => {
  const pct = typeof progress === "number" ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null

  return (<div
    aria-busy="true"
    aria-label={pct !== null ? `${label} ${pct}%` : label}
    aria-live="polite"
    className={styles.loadingScreenRoot}
    role="status">
    <img
      alt=""
      aria-hidden="true"
      className={styles.loadingScreenBg}
      draggable={false}
      src={getLoadingScreenImage()}/>

    {/* Bar block — sits in the art's dark bottom band, mockup-style. */}
    <div className={styles.loadingScreenHud}>
      <div
        aria-hidden="true"
        className={styles.loadingScreenLabel}>
        <span className={`${styles.loadingScreenTail} ${styles.loadingScreenTailLeft}`}/>
        <span>
          {label}
          {pct !== null ? <span className={styles.loadingScreenPct}>{pct}%</span> : null}
        </span>
        <span className={`${styles.loadingScreenTail} ${styles.loadingScreenTailRight}`}/>
      </div>
      <div className={styles.loadingScreenTrack}>
        {/* The clip wrapper is what keeps the sliding fill INSIDE the
              rounded track — clip-path on the fill itself travels with its
              transform, so it never clipped anything (the bar visibly slid
              in from outside the frame). */}
        <div className={styles.loadingScreenClip}>
          <div
            className={styles.loadingScreenFill}
            style={pct !== null ? {
              // Deterministic: driven by the caller's real progress.
              animation: "none",
              transform: `translateX(-${100 - Math.max(pct, 4)}%)`,
            } : undefined}/>
        </div>
      </div>
    </div>
  </div>)
}
