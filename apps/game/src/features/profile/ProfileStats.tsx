import {skipToken} from "@reduxjs/toolkit/query/react"

import {formatCompactNumber} from "../../lib/format"
import styles from "../../pages/Profile.module.css"
import {useAppSelector} from "../../store/hooks"
import {selectAuthUserId} from "../auth/authSelectors"
import {useGetOwnerStatsQuery} from "../playerData/playerDataApi"

type StatIcon = "coins" | "gems" | "finished" | "wins" | "losses" | "hotseat"

const STAT_ICON_CLASS: Record<StatIcon, string> = {
  coins: styles.profileStatIconCoins,
  gems: styles.profileStatIconGems,
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
  readonly icon: "coins" | "gems" | "finished" | "wins" | "losses" | "hotseat",
  readonly label: string,
  readonly value: number,
  readonly wide?: boolean,
}) {
  // Coins + Gems use the real webp icons (same artwork as the
  // wallet pills + lobby) instead of the CSS-painted profile-
  // stat-icon sprites. Other stat icons stay on the sprites.
  const realIcon = icon === "coins" ? "/lobby/icons/gold-coin.webp" : icon === "gems" ? "/lobby/icons/gem.webp" : null

  return (<div className={`${styles.profileStatCard}${wide ? ` ${styles.profileStatCardWide}` : ""}`}>
    {realIcon ? (<span
      aria-hidden="true"
      className={styles.profileStatIconWrap}>
      <img
        alt=""
        className={styles.profileStatImg}
        draggable={false}
        src={realIcon}/>
    </span>) : (<span
      aria-hidden="true"
      className={`${styles.profileStatIcon} ${STAT_ICON_CLASS[icon]}`}>
      <span/>
    </span>)}
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
