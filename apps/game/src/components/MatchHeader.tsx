import {memo} from "react"

import {useNavigate} from "react-router-dom"

import type {MatchState} from "../../../../packages/engine/src/match"
import {useNavigationLoaderOverlay} from "../features/appUi/useNavigationLoaderOverlay"

import styles from "./MatchHeader.module.css"

type Props = {
  match: MatchState,
  whitePip: number,
  blackPip: number,
  turnLabel: string,
  inCrawford: boolean,
  whiteName?: string,
  blackName?: string,
}

function displayName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "Player"
  return trimmed.split(/\s+/)[0] ?? trimmed
}

export const MatchHeader = memo(function MatchHeader({
  match,
  whitePip,
  blackPip,
  turnLabel,
  inCrawford,
  whiteName = "White",
  blackName = "Black",
}: Props) {
  const navigate = useNavigate()
  const {show: showOverlay} = useNavigationLoaderOverlay()
  const cleanTurnLabel = turnLabel.replace(/\s*\(AI\)/i, "").toUpperCase()
  const whiteDisplayName = displayName(whiteName).toUpperCase()
  const blackDisplayName = displayName(blackName).toUpperCase()

  const goHome = () => {
    // Put the loader up before the route changes so the gameplay never
    // flashes between unmount and the lobby's own preload gate.
    showOverlay()
    navigate("/play")
  }

  return (
    <header className={styles.header}>
      <div className={styles.navHome}>
        <button
          aria-label="Back to lobby"
          className={styles.homeLink}
          type="button"
          onClick={goHome}>
          <img
            alt=""
            className={styles.homeImage}
            draggable={false}
            src="/gameplay/premium-purple/lobby.webp"/>
        </button>
      </div>

      <div className={styles.hud}>
        {/* "MATCH TO N" sits ABOVE the header asset, not inside it.
         * Hidden for quick-match (target=1) — every match is a single
         * game so the framing is just noise. The label comes back as
         * soon as tournaments use a larger target. */}
        {match.target > 1 && (<div className={styles.label}>Match to {match.target}</div>)}

        {/* The new header art has the rails baked in, so the row just
            contains the pill with the score overlay + turn label. The
            player names overlay the rail areas of the art at left/right. */}
        <div className={styles.hudRow}>
          <div className={styles.hudPill}>
            <img
              alt=""
              className={styles.hudArt}
              draggable={false}
              src="/gameplay/premium-purple/header.webp"/>
            <div
              aria-label={`${whiteDisplayName} pip count`}
              className={`${styles.scorePlayer} ${styles.scorePlayerLeft}`}>
              <span>{whiteDisplayName}</span>
              <strong>{whitePip}</strong>
            </div>
            <div className={styles.scoreCore}>
              {match.target > 1 ? (<>
                <span>{match.score.white}</span>
                <span className={styles.scoreSeparator}>:</span>
                <span>{match.score.black}</span>
              </>) : (<span className={styles.scoreSeparator}>VS</span>)}
            </div>
            <div
              aria-label={`${blackDisplayName} pip count`}
              className={`${styles.scorePlayer} ${styles.scorePlayerRight}`}>
              <span>{blackDisplayName}</span>
              <strong>{blackPip}</strong>
            </div>
            {/* Turn indicator sits in the BOTTOM tab of the header art. */}
            <div className={styles.turnPill}>
              <span className={styles.turnDot}/>
              <span>{cleanTurnLabel}</span>
              {inCrawford && <span className={styles.crawfordPill}>Crawford</span>}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
})
