import {useIsMobileLayout} from "../lib/useMediaQuery"

import styles from "./BoardLayout.module.css"

type Props = {
  /** The opponent (top-of-screen / left side panel). */
  opponentPanel: React.ReactNode,
  /** The local player (bottom-of-screen / right side panel). */
  selfPanel: React.ReactNode,
  /** Top header (status, match score, nav). */
  header?: React.ReactNode,
  /** The board itself — children render in the centre table. */
  children: React.ReactNode,
  /** Floating action row over the board (Roll / Double / Undo). */
  actionsOverlay?: React.ReactNode,
  /** Modal overlay (cube decision, end-of-game, etc.) — fills the centre. */
  centerOverlay?: React.ReactNode,
  /** Dedicated gameplay background for the selected board, with lobby art as a fallback. */
  backgroundImage?: string,
}

/**
 * Mobile-first game table. Narrow screens get compact player HUDs above
 * the board so the playing surface owns the viewport; wider screens grow
 * into the reference-style side panels around a large central board.
 *
 * Only the layout matching the current aspect ratio is mounted — the hidden
 * variant is not rendered at all, so we don't build its panel DOM (avatars,
 * stat images, timers) on every screen.
 */
export function BoardLayout({
  opponentPanel,
  selfPanel,
  header,
  children,
  actionsOverlay,
  centerOverlay,
  backgroundImage,
}: Props) {
  const isMobileLayout = useIsMobileLayout()

  return (
    <div className={styles.screen}>
      {backgroundImage && (
        <img
          alt=""
          className={styles.backgroundImage}
          draggable={false}
          src={backgroundImage}/>
      )}
      <div className={styles.backgroundTone}/>

      <div className={styles.content}>
        {header}

        <div className={styles.stage}>
          {isMobileLayout ? (<div className={styles.mobilePlayers}>
            {opponentPanel}
            {selfPanel}
          </div>) : (<>
            <div className={`${styles.sideSlot} ${styles.sideSlotLeft}`}>
              {opponentPanel}
            </div>

            <div className={`${styles.sideSlot} ${styles.sideSlotRight}`}>
              {selfPanel}
            </div>
          </>)}

          <div className={styles.boardColumn}>
            <div className={styles.boardStage}>
              <div className={styles.boardShell}>{children}</div>
            </div>

            {actionsOverlay && (<div className={styles.actionsLayer}>
              <div className={styles.actionsInner}>{actionsOverlay}</div>
            </div>)}

            {centerOverlay && (<div className={styles.centerLayer}>
              <div className={styles.centerInner}>{centerOverlay}</div>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
