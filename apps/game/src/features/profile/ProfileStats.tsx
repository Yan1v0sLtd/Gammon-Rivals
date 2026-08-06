import {skipToken} from "@reduxjs/toolkit/query/react"

import {formatCompactNumber} from "../../lib/format"
import {useAppSelector} from "../../store/hooks"
import {selectAuthUserId} from "../auth/authSelectors"
import {useGetOwnerStatsQuery} from "../playerData/playerDataApi"

import styles from "./ProfileStats.module.css"

type StatIcon = "finished" | "wins" | "losses" | "hotseat"

const STAT_ICON_CLASS: Record<StatIcon, string> = {
  finished: styles.profileStatIconFinished,
  wins: styles.profileStatIconWins,
  losses: styles.profileStatIconLosses,
  hotseat: styles.profileStatIconHotseat,
}

function Stat({
  icon,
  label,
  value,
  wide = false,
}: {
  readonly icon: StatIcon,
  readonly label: string,
  readonly value: number,
  readonly wide?: boolean,
}) {
  return (<div className={`${styles.profileStatCard}${wide ? ` ${styles.profileStatCardWide}` : ""}`}>
    <span
      aria-hidden="true"
      className={`${styles.profileStatIcon} ${STAT_ICON_CLASS[icon]}`}>
      <span/>
    </span>
    {/* Value sized so something like "16.6K" fits without overflowing. */}
    <strong className={styles.profileStatValue}>{formatCompactNumber(value)}</strong>
    <small>{label}</small>
  </div>)
}

export function ProfileStats() {
  const userId = useAppSelector(selectAuthUserId)
  const {data: stats} = useGetOwnerStatsQuery(userId ?? skipToken)

  return (<section
    aria-label="Player stats"
    className={styles.profileStatGrid}>
    <Stat
      icon="finished"
      label="Finished"
      value={stats?.totalFinished ?? 0}/>
    <Stat
      icon="wins"
      label="AI Wins"
      value={stats?.aiWins ?? 0}/>
    <Stat
      icon="losses"
      label="AI Losses"
      value={stats?.aiLosses ?? 0}/>
    <Stat
      icon="hotseat"
      label="Hot-seat"
      value={stats?.hotseatPlayed ?? 0}/>
  </section>)
}
