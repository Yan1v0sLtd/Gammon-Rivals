import {memo, type ReactNode} from "react"

import styles from "./PlayerPanelShell.module.css"

type PlayerPanelShellProps = {
  side: "left" | "right",
  compact: boolean,
  isTurn?: boolean,
  identity: ReactNode,
  stats: ReactNode,
  timer: ReactNode,
  bottomSlot?: ReactNode,
  align: string,
}

export const PlayerPanelShell = memo(function PlayerPanelShell({
  side,
  compact,
  isTurn,
  identity,
  stats,
  timer,
  bottomSlot,
  align,
}: PlayerPanelShellProps) {
  const turnClass = isTurn ? styles.isTurn : ""

  if (!compact) {
    return (
      <aside
        className={`${styles.panel} ${styles[side]} ${turnClass}`}>
        <div className={styles.card}>
          <div className={styles.cardGlow}/>
          <div className={styles.top}>
            {identity}
          </div>

          <div className={styles.statList}>
            <img
              alt=""
              className={styles.statsArt}
              draggable={false}
              src="/gameplay/premium-purple/player-stats.webp"/>
            {stats}
          </div>

          {timer}
        </div>
        {bottomSlot && <div className={styles.panelBottom}>{bottomSlot}</div>}
      </aside>
    )
  }

  return (
    <aside
      className={`${styles.compactPanel} ${styles[side]} ${turnClass} ${side === "right" ? styles.justifyEnd : styles.justifyStart}`}>
      <div className={styles.compactTop}>
        {identity}
      </div>

      <div className={styles.compactStatList}>
        {stats}
      </div>

      {timer}
      {bottomSlot && <div className={`${styles.bottomSlot} ${align === "items-end" ? styles.bottomSlotEnd : styles.bottomSlotStart}`}>{bottomSlot}</div>}
    </aside>
  )
})
